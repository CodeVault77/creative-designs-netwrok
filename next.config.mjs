/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // Required for styled-components: enables the SWC transform that adds
  // stable class names + SSR support. Without this, server-rendered markup
  // and client hydration produce different class names.
  compiler: {
    styledComponents: {
      displayName: process.env.NODE_ENV !== 'production',
      ssr: true,
      fileName: false,
    },
  },

  // Fail the production build on type or lint errors. The alternative
  // (ignoreBuildErrors) lets broken code reach production; P13 depends on
  // this staying honest from day one.
  typescript: { ignoreBuildErrors: false },
  eslint: { ignoreDuringBuilds: false },

  poweredByHeader: false,

  async headers() {
    const isProduction = process.env.NODE_ENV === 'production';

    /**
     * Content Security Policy.
     *
     * Each directive below is the tightest value the application actually
     * works under. Where something is loose, the reason is stated — a policy
     * with unexplained holes gets copied, and the holes travel with it.
     */
    const csp = [
      "default-src 'self'",

      /*
       * 'unsafe-inline' for scripts is Next's bootstrap.
       *
       * The App Router inlines the hydration payload and the runtime's own
       * bootstrap into the document. The correct fix is a per-request nonce,
       * which needs middleware this project does not have yet; until then a
       * policy WITH this is still meaningfully better than no policy, because
       * every other directive below still holds.
       *
       * 'unsafe-eval' is development only — React Fast Refresh and webpack's
       * dev runtime both need it, and neither ships to production.
       */
      isProduction
        ? "script-src 'self' 'unsafe-inline'"
        : "script-src 'self' 'unsafe-inline' 'unsafe-eval'",

      /*
       * styled-components injects rules through a runtime stylesheet, so
       * inline styles are not optional here — this is the cost of the styling
       * decision in ADR-0008, written down where someone tightening the policy
       * will find it before breaking every page.
       */
      "style-src 'self' 'unsafe-inline'",

      /*
       * Images come from anywhere over TLS.
       *
       * An `image` node's payload holds a URL the user chose, and a map that
       * can only show pictures we host is not the product. `data:` covers the
       * inlined brand mark; `blob:` covers canvas exports.
       */
      "img-src 'self' data: blob: https:",

      // Self-hosted through next/font, so no external font origin is needed.
      "font-src 'self'",

      // Same-origin only: the SSE stream and every API route are local. The
      // Anthropic and email APIs are called from the server, never the browser.
      "connect-src 'self'",

      // Nothing embeds this app, and it embeds nothing.
      "frame-ancestors 'none'",
      "frame-src 'none'",
      "object-src 'none'",

      // Stops an injected <base> redirecting every relative URL on the page.
      "base-uri 'self'",

      // A form cannot be made to POST credentials somewhere else.
      "form-action 'self'",
    ].join('; ');

    const headers = [
      { key: 'Content-Security-Policy', value: csp },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      // Redundant beside frame-ancestors, kept for browsers that predate CSP.
      { key: 'X-Frame-Options', value: 'DENY' },
      {
        key: 'Permissions-Policy',
        value: 'camera=(), microphone=(), geolocation=()',
      },
    ];

    /*
     * HSTS is production only, and deliberately.
     *
     * The header tells a browser to refuse plain HTTP for this host for two
     * years. Sent from a local or preview environment on a shared hostname it
     * would do exactly that to a domain that may not have TLS everywhere yet,
     * and the browser will not forget on request. `preload` is left OFF: it is
     * effectively irreversible and belongs to a deliberate submission, not to
     * a config default.
     */
    if (isProduction) {
      headers.push({
        key: 'Strict-Transport-Security',
        value: 'max-age=63072000; includeSubDomains',
      });
    }

    return [{ source: '/:path*', headers }];
  },
};

export default nextConfig;
