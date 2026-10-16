import express, { RequestHandler } from 'express';

/** Photos stay public; document paths must reach the authenticated controller. */
export function publicUploads(root: string): RequestHandler {
  const serve = express.static(root, {
    setHeaders: (response) => response.setHeader('Cross-Origin-Resource-Policy', 'cross-origin'),
  });
  return (request, response, next) => {
    let path: string;
    try { path = decodeURIComponent(request.path); }
    catch { next(); return; }
    if (!/^\/[a-f0-9-]{36}\/photo\/[a-f0-9-]{36}\.(jpg|png|webp)$/i.test(path)) {
      next();
      return;
    }
    serve(request, response, next);
  };
}
