import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Counsel",
    short_name: "Counsel",
    description: "Honest counsel on which roles are worth your time, and the materials to go after them.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    // Matches the dark canvas: the splash screen should be the app,
    // not a flash of the old palette before it loads.
    background_color: "#0a0b0d",
    theme_color: "#0a0b0d",
    // ?v= for the same reason as the touch icon in layout.tsx: iOS 17 reads
    // these too, and a corrected file at an unchanged URL does not reach a
    // phone that already cached the broken one. Keep the two in step.
    // Puts Counsel in the OS share sheet, so a job link can be sent straight
    // here from LinkedIn instead of copied, pasted and tracked by hand.
    //
    // GET rather than POST on purpose: a GET target is an ordinary navigation,
    // so the session cookie travels with it and the auth gate behaves. A POST
    // share target arrives without one, bounces to /login, and the shared link
    // is lost.
    //
    // Android and desktop Chrome honour this. **iOS does not implement
    // share_target at all**, so the app cannot appear in an iPhone share sheet
    // however this is written - the Shortcut described in /share is the answer
    // there, and it reaches the same page.
    share_target: {
      action: "/share",
      method: "GET",
      params: { title: "title", text: "text", url: "url" },
    },
    icons: [
      { src: "/icons/icon-192.png?v=2", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png?v=2", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png?v=2", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
