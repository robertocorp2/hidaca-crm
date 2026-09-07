import http from "node:http";

const listenPort = Number(process.env.HIDACA_PROXY_PORT || 3001);
const targetPort = Number(process.env.HIDACA_APP_PORT || 3000);
const email = process.env.HIDACA_E2E_EMAIL;
if (!email) throw new Error("HIDACA_E2E_EMAIL is required.");

const server = http.createServer((request, response) => {
  const headers = {
    ...request.headers,
    host: `[::1]:${targetPort}`,
    "oai-authenticated-user-email": email,
    "oai-authenticated-user-full-name": encodeURIComponent("HIDACA E2E"),
    "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
  };
  const upstream = http.request(
    {
      hostname: "::1",
      port: targetPort,
      method: request.method,
      path: request.url,
      headers,
    },
    (upstreamResponse) => {
      response.writeHead(
        upstreamResponse.statusCode ?? 502,
        upstreamResponse.headers,
      );
      upstreamResponse.pipe(response);
    },
  );
  upstream.on("error", (error) => {
    response.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
    response.end(`Local proxy error: ${error.message}`);
  });
  request.pipe(upstream);
});

server.listen(listenPort, "127.0.0.1", () => {
  console.log(`HIDACA local auth proxy: http://127.0.0.1:${listenPort}`);
});
