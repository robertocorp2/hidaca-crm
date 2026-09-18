/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import {
  MaintenanceModeError,
  WRITE_LEASE_GENERATION_HEADER,
  WRITE_LEASE_ID_HEADER,
  maintenanceResponse,
  withWriteLease,
} from "../app/lib/write-barrier";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    if (!isMutation(request.method) || isMaintenanceEndpoint(url.pathname)) {
      return handler.fetch(request, env, ctx);
    }

    try {
      return await withWriteLease(env.DB, writerKind(url.pathname), async (lease) => {
        const headers = new Headers(request.headers);
        headers.set(WRITE_LEASE_ID_HEADER, lease.id);
        headers.set(WRITE_LEASE_GENERATION_HEADER, String(lease.generation));
        return handler.fetch(new Request(request, { headers }), env, ctx);
      }, request.headers.get("x-request-id") ?? undefined);
    } catch (error) {
      if (error instanceof MaintenanceModeError) return maintenanceResponse(error);
      throw error;
    }
  },
};

export default worker;

function isMutation(method: string) {
  return method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE";
}

function isMaintenanceEndpoint(pathname: string) {
  return pathname === "/api/maintenance" || pathname.startsWith("/api/maintenance/");
}

function writerKind(pathname: string) {
  if (pathname === "/api/whatsapp/webhook") return "whatsapp-webhook";
  if (pathname.startsWith("/v1/")) return "v1:" + pathname.slice(4, 100);
  return "api:" + pathname.slice(0, 100);
}
