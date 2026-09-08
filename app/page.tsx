import { redirect } from "next/navigation";
import { chatGPTSignInPath, getChatGPTUser } from "./chatgpt-auth";

export default async function HomePage() {
  const user = await getChatGPTUser();
  if (user) redirect("/app");

  return (
    <main className="login-shell">
      <section className="login-card">
        <div className="login-mark">H</div>
        <p className="eyebrow">HIDACA Constructora S.R.L.</p>
        <h1>Operaciones</h1>
        <p>
          Acceso privado para el equipo autorizado. Inicia sesión con tu cuenta
          de ChatGPT y el sistema verificará la lista de acceso de HIDACA.
        </p>
        <a className="primary-button" href={chatGPTSignInPath("/app")}>
          Iniciar sesión con ChatGPT
        </a>
        <span className="security-note">
          Los datos no están disponibles públicamente.
        </span>
      </section>
    </main>
  );
}
