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
    .select('rol, nombre, correo, activo, tenant_id')
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
