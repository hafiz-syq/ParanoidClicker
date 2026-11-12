export {};

// wrangler types hanya menaruh binding dari config; secret harus digabung manual
// ke kedua nama yang dipakai kode (Env global dan Cloudflare.Env versi test).
declare global {
  interface Env {
    SESSION_SIGNING_KEY: string;
  }
  namespace Cloudflare {
    interface Env {
      SESSION_SIGNING_KEY: string;
    }
  }
}
