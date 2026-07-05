// =========================================================================
// Edge Function: admin-usuarios (versión multi-tenant)
// - super_admin: puede crear/gestionar usuarios de CUALQUIER tenant, y crear admins.
// - admin: solo puede crear/gestionar "usuario" DENTRO de su propio tenant.
// =========================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const encabezadosCORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: encabezadosCORS });

  try {
    const token = (req.headers.get("Authorization") || "").replace("Bearer ", "");
    const { data: { user }, error: errUser } = await adminClient.auth.getUser(token);
    if (errUser || !user) return respuesta({ error: "No autorizado. Vuelve a iniciar sesión." }, 401);

    const { data: llamador } = await adminClient
      .from("perfiles")
      .select("rol, activo, tenant_id")
      .eq("id", user.id)
      .single();

    if (!llamador || llamador.activo === false || !["admin", "super_admin"].includes(llamador.rol)) {
      return respuesta({ error: "No tienes permisos de administrador." }, 403);
    }

    const esSuper = llamador.rol === "super_admin";
    const body = await req.json();
    const { accion } = body;

    if (accion === "crear_usuario") {
      const { correo, clave, nombre, rol, tenant_id } = body;
      if (!correo || !clave) return respuesta({ error: "Correo y contraseña son obligatorios." }, 400);

      const rolFinal = rol === "admin" ? "admin" : "usuario";
      if (rolFinal === "admin" && !esSuper) {
        return respuesta({ error: "Solo un super administrador puede crear otros administradores." }, 403);
      }

      const tenantFinal = esSuper ? (tenant_id || null) : llamador.tenant_id;
      if (!tenantFinal) return respuesta({ error: "Falta indicar el tenant (cliente)." }, 400);

      const { data, error } = await adminClient.auth.admin.createUser({
        email: correo,
        password: clave,
        email_confirm: true,
        user_metadata: { nombre: nombre || correo, rol: rolFinal, tenant_id: tenantFinal },
      });
      if (error) throw error;
      return respuesta({ ok: true, id: data.user.id });
    }

    if (accion === "resetear_clave") {
      const { userId, claveNueva } = body;
      if (!userId || !claveNueva) return respuesta({ error: "Faltan datos." }, 400);

      if (!esSuper) {
        const { data: objetivo } = await adminClient.from("perfiles").select("tenant_id").eq("id", userId).single();
        if (!objetivo || objetivo.tenant_id !== llamador.tenant_id) {
          return respuesta({ error: "Ese usuario no pertenece a tu cliente." }, 403);
        }
      }

      const { error } = await adminClient.auth.admin.updateUserById(userId, { password: claveNueva });
      if (error) throw error;
      return respuesta({ ok: true });
    }

    if (accion === "eliminar_usuario") {
      const { userId } = body;
      if (!userId) return respuesta({ error: "Falta el id del usuario." }, 400);

      if (!esSuper) {
        const { data: objetivo } = await adminClient.from("perfiles").select("tenant_id, rol").eq("id", userId).single();
        if (!objetivo || objetivo.tenant_id !== llamador.tenant_id || objetivo.rol !== "usuario") {
          return respuesta({ error: "No puedes eliminar esta cuenta." }, 403);
        }
      }

      const { error } = await adminClient.auth.admin.deleteUser(userId);
      if (error) throw error;
      return respuesta({ ok: true });
    }

    return respuesta({ error: "Acción no reconocida." }, 400);

  } catch (err) {
    return respuesta({ error: err.message }, 500);
  }
});

function respuesta(objeto, status) {
  return new Response(JSON.stringify(objeto), {
    status,
    headers: { "Content-Type": "application/json", ...encabezadosCORS },
  });
}
