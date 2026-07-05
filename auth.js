// =========================================================================
// auth.js — Sesión, roles Y multi-tenant (con bloqueo por suscripción vencida)
// Debe cargarse DESPUÉS de conexion.js en cada página protegida.
// =========================================================================

/**
 * Exige sesión iniciada y, opcionalmente, un rol específico.
 * Devuelve { session, perfil, tenant, habilitado } o null (y redirige).
 *
 * "habilitado" = true/false según si la suscripción del tenant está vigente.
 * super_admin siempre tiene habilitado = true (no pertenece a un tenant).
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

  if (rolRequerido && perfil.rol !== rolRequerido) {
    window.location.href = paginaSegunRol(perfil.rol);
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
  }

  return { session, perfil, tenant, habilitado };
}

function paginaSegunRol(rol) {
  if (rol === 'super_admin') return "superadmin.html";
  if (rol === 'admin') return "admin.html";
  return "registro.html";
}

async function cerrarSesion() {
  await _supabase.auth.signOut();
  window.location.href = "index.html";
}

/**
 * Muestra un banner de "suscripción vencida" y bloquea los botones de envío
 * indicados (sin ocultar la página, tal como se pidió: se puede VER pero no USAR).
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
