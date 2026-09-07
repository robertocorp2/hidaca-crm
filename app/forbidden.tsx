export default function Forbidden() {
  return (
    <main className="login-shell">
      <section className="login-card">
        <div className="login-mark">403</div>
        <p className="eyebrow">Acceso restringido</p>
        <h1>No tienes permiso para ver esta sección</h1>
        <p>Solicita a un administrador que revise tus permisos de HIDACA.</p>
        <a className="primary-button" href="/app">Volver al inicio</a>
      </section>
    </main>
  );
}
