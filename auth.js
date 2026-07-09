// =========================================================================
// auth.js — Sesión, roles, multi-tenant, bloqueo por suscripción vencida,
// y mantiene el "slug" del cliente visible en la URL (para soporte/debug).
// Debe cargarse DESPUÉS de conexion.js en cada página protegida.
// =========================================================================

/**
 * Exige sesión iniciada y, opcionalmente, un rol específico.
 * Devuelve { session, perfil, tenant, habilitado } o null (y redirige).
 */
async function requerirSesion(rolRequerido) {
  const { data: { session } } = await _supabase.auth.getSession();

  if (!session) {
    window.location.href = "index.html";
    return null;
  }

  const { data: perfil, error } = await _supabase
    .from('perfiles')
    .select('rol, nombre, correo, activo, tenant_id, terminos_aceptados')
    .eq('id', session.user.id)
    .single();

  if (error || !perfil || perfil.activo === false) {
    await _supabase.auth.signOut();
    window.location.href = "index.html";
    return null;
  }

  let tenant = null;
  let habilitado = true;

  if (perfil.rol !== 'super_admin') {
    const { data: tenantData } = await _supabase
      .from('tenants')
      .select('id, slug, nombre, logo_url, color_principal, activo')
      .eq('id', perfil.tenant_id)
      .single();
    tenant = tenantData || null;

    const { data: estaHabilitado } = await _supabase
      .rpc('tenant_esta_habilitado', { p_tenant_id: perfil.tenant_id });
    habilitado = !!estaHabilitado;

    // Deja el nombre del cliente visible en la URL, ej: registro.html?tenant=el_profe
    // (no recarga la página, solo actualiza lo que se ve en la barra de direcciones)
    if (tenant && tenant.slug) {
      mantenerSlugEnURL(tenant.slug);
    }
  }

  if (rolRequerido && perfil.rol !== rolRequerido) {
    window.location.href = agregarSlugALaURL(paginaSegunRol(perfil.rol), tenant ? tenant.slug : null);
    return null;
  }

  return { session, perfil, tenant, habilitado };
}

function mantenerSlugEnURL(slug) {
  const params = new URLSearchParams(window.location.search);
  if (params.get("tenant") !== slug) {
    params.set("tenant", slug);
    const nuevaURL = window.location.pathname + "?" + params.toString();
    history.replaceState(null, "", nuevaURL);
  }
}

function agregarSlugALaURL(pagina, slug) {
  return slug ? `${pagina}?tenant=${encodeURIComponent(slug)}` : pagina;
}

function paginaSegunRol(rol) {
  if (rol === 'super_admin') return "superadmin.html";
  if (rol === 'admin') return "admin.html";
  return "registro.html";
}

async function cerrarSesion() {
  // Conserva el slug actual (si lo hay) para que el login siga mostrando el logo correcto
  const params = new URLSearchParams(window.location.search);
  const slug = params.get("tenant");
  await _supabase.auth.signOut();
  window.location.href = agregarSlugALaURL("index.html", slug);
}

/**
 * Si el usuario (admin o vendedor) todavía no aceptó los Términos y Condiciones,
 * muestra un aviso a pantalla completa que bloquea el uso del sistema hasta
 * que los lea y acepte. Se llama justo después de requerirSesion().
 */
function mostrarTerminosSiHaceFalta(perfil) {
  return new Promise((resolve) => {
    if (perfil.terminos_aceptados) { resolve(); return; }

    const overlay = document.createElement('div');
    overlay.style.cssText = "position:fixed; inset:0; background:rgba(0,0,0,0.75); z-index:99999; display:flex; align-items:center; justify-content:center; padding:20px;";

    overlay.innerHTML = `
      <div style="background:white; max-width:600px; width:100%; max-height:85vh; display:flex; flex-direction:column; border-radius:10px; overflow:hidden;">
        <div style="padding:20px 24px 10px; border-bottom:1px solid #eee;">
          <h2 style="margin:0; font-size:1.2rem; color:#2c3e50;">Términos y Condiciones de Uso y Tratamiento de Datos</h2>
        </div>
        <div style="padding:16px 24px; overflow-y:auto; font-size:0.85rem; line-height:1.5; color:#333; flex:1;">
          <p><strong>Resumen:</strong> Al usar este sistema para registrar cartones, aceptas que:</p>
          <ul style="padding-left:18px;">
            <li>Los datos de los participantes (nombre, cédula/DNI, teléfono, correo) se recogen únicamente para identificar al comprador de cada cartón y poder contactarlo en caso de ganar un premio.</li>
            <li><strong>Tú (el cliente/vendedor) eres responsable</strong> de la veracidad de esos datos y del uso que les des. El proveedor del sistema solo aloja la información, no la valida ni la usa con fines propios.</li>
            <li>Debes eliminar los datos de los participantes al finalizar tu evento (usando la función de vaciar registros), antes de iniciar un evento nuevo.</li>
            <li>Tu correo y contraseña de acceso a este sistema son de uso interno/operativo — pueden no ser tus datos personales reales, y no debes reutilizar contraseñas de tus cuentas personales aquí.</li>
            <li>El sistema guarda un registro de auditoría de las acciones administrativas (crear, editar, eliminar) con el único fin de dar soporte técnico y mejorar el sistema — no se usa para otros fines.</li>
          </ul>
          <p>Este resumen no reemplaza el documento completo. Puedes solicitar el documento completo de Términos y Condiciones a tu proveedor del sistema.</p>
        </div>
        <div style="padding:16px 24px; border-top:1px solid #eee; background:#fafafa;">
          <label style="display:flex; align-items:center; gap:8px; font-size:0.85rem; cursor:pointer;">
            <input type="checkbox" id="chkAceptoTerminos" style="width:auto; margin:0;">
            He leído y acepto los Términos y Condiciones
          </label>
          <button id="btnAceptarTerminos" disabled style="width:100%; margin-top:12px; padding:12px; background:#ccc; color:white; border:none; border-radius:6px; font-weight:bold; cursor:not-allowed;">Continuar</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const chk = overlay.querySelector('#chkAceptoTerminos');
    const btn = overlay.querySelector('#btnAceptarTerminos');

    chk.addEventListener('change', () => {
      btn.disabled = !chk.checked;
      btn.style.background = chk.checked ? '#2ecc71' : '#ccc';
      btn.style.cursor = chk.checked ? 'pointer' : 'not-allowed';
    });

    btn.addEventListener('click', async () => {
      if (!chk.checked) return;
      btn.disabled = true;
      btn.innerText = "Guardando...";
      try {
        await _supabase.rpc('aceptar_terminos');
      } catch (e) {
        console.error("No se pudo guardar la aceptación:", e.message);
      }
      overlay.remove();
      resolve();
    });
  });
}

/**
 * Muestra un banner de "suscripción vencida" y bloquea los botones indicados.
 */
function bloquearPorSuscripcionVencida(idsBotonesABloquear) {
  const banner = document.createElement('div');
  banner.style.cssText = "background:#d63031; color:white; text-align:center; padding:14px; font-weight:bold; position:sticky; top:0; z-index:9999;";
  banner.innerText = "⚠️ La suscripción de este cliente venció. Contacta al proveedor del sistema para renovarla.";
  document.body.prepend(banner);

  (idsBotonesABloquear || []).forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.disabled = true; el.style.opacity = "0.5"; el.style.cursor = "not-allowed"; }
  });
}
