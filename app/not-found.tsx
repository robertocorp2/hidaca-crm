import Link from "next/link";

export default function NotFound() {
  return (
    <main className="login-shell">
      <section className="login-card" aria-labelledby="not-found-title">
        <div className="login-mark" aria-hidden="true">
          404
        </div>
        <p className="eyebrow">HIDACA Operaciones</p>
        <h1 id="not-found-title">Página no encontrada</h1>
        <p>
          La dirección que buscas no existe o dejó de estar disponible.
        </p>
        <Link className="primary-button" href="/app">
          Volver al inicio
        </Link>
        <span className="security-note">
          El acceso al CRM sigue protegido y requiere una sesión autorizada.
        </span>
      </section>
    </main>
  );
}
