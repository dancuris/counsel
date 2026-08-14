import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { cookies } from "next/headers";
import { logout } from "./logout/actions";
import { NavLinks } from "@/components/NavLinks";
import { AskBox } from "@/components/AskBox";
import { VersionFooter } from "@/components/VersionFooter";
import { recordDeployment } from "@/lib/release";
import { ServiceWorkerRegistrar } from "@/components/ServiceWorkerRegistrar";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";
import { getThemeChoice } from "@/lib/theme-server";
import "./globals.css";
import { DemoBanner } from "@/components/DemoBanner";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Counsel",
  description: "Honest counsel on which roles are worth your time, and the materials to go after them.",
  applicationName: "Counsel",
  // noindex everywhere. The only pages a crawler can reach are the landing,
  // privacy policy and terms, and none of them belong in search results - this
  // is one person's private job search, not a product with an audience.
  robots: { index: false, follow: false, nocache: true },
  // The ?v= is a cache-buster, and it has to stay. iOS caches the touch icon
  // per URL and keeps it after the home-screen icon is deleted and re-added,
  // so a corrected file at the same path never reaches the phone. The 180px
  // icon shipped broken once (the artwork scaled up and clipped), and deleting
  // and re-adding did not pick up the fix. Bump the number whenever the
  // artwork changes; nothing else forces a refetch.
  icons: {
    icon: [
      { url: "/favicon.png?v=2", type: "image/png" },
      { url: "/icon.png?v=2", sizes: "256x256", type: "image/png" },
    ],
    apple: [{ url: "/apple-icon.png?v=2", sizes: "180x180", type: "image/png" }],
  },
  // Lets iOS launch it full-screen from the home screen instead of in Safari chrome.
  appleWebApp: {
    capable: true,
    title: "Counsel",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  // Matches the canvas in each theme, so the iOS status bar area blends into
  // the app rather than banding against it.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f5f3" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0b0d" },
  ],
  width: "device-width",
  initialScale: 1,
  // Standalone home-screen apps shouldn't rubber-band like a web page.
  viewportFit: "cover",
};

/**
 * Four destinations, each answering one question, plus two that are not daily.
 *
 * The first item used to be called "Pipeline" and pointed at `/`, which was not
 * the pipeline: it was triage, intake, the mail panel and a sixty-role table on
 * one route. Naming a page after a quarter of its contents is why rearranging
 * it never helped. Today is what needs you now; Pipeline is every role you are
 * tracking; they are different questions and now different pages.
 *
 * Retrospective and Profile are deliberately not here. They are visited
 * occasionally and were costing two of five slots in the primary nav.
 */
const NAV_LINKS = [
  { href: "/", label: "Today" },
  { href: "/pipeline", label: "Pipeline" },
  { href: "/inbox", label: "Inbox" },
  { href: "/contacts", label: "Contacts" },
  { href: "/companies", label: "Companies" },
];

const UTILITY_LINKS = [
  { href: "/retrospective", label: "Retrospective" },
  { href: "/profile", label: "Profile" },
  { href: "/settings", label: "Settings" },
];

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const authenticated = await verifySessionToken(cookieStore.get(SESSION_COOKIE)?.value);
  const theme = await getThemeChoice();
  // Stamps the first request this build serves, which is what gives /releases
  // real deploy times rather than commit times. No-ops on a warm instance.
  await recordDeployment();

  return (
    <html
      lang="en"
      // "system" sets no attribute at all, leaving prefers-color-scheme in
      // globals.css to decide. See src/lib/theme.ts.
      data-theme={theme === "system" ? undefined : theme}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <DemoBanner />
        {authenticated && (
          <header className="sticky top-0 z-40 border-b border-line bg-[var(--bg)]">
            <div className="mx-auto flex max-w-[1240px] items-center justify-between gap-4 px-4 py-3 sm:px-7">
              <Link href="/" className="flex flex-none items-center gap-2.5">
                {/* The mark is the only saturated object in the chrome, and it
                    carries the same warm accent that means "this needs you". */}
                <span className="grid h-[26px] w-[26px] flex-none place-items-center rounded-lg bg-[var(--amber)]">
                  <svg viewBox="0 0 100 100" fill="none" className="h-[17px] w-[17px] text-[#0f1114]" aria-hidden>
                    <path d="M66 28 A30 30 0 1 0 66 72" stroke="currentColor" strokeWidth="12.5" strokeLinecap="round" />
                    <circle cx="76" cy="50" r="7.5" fill="currentColor" />
                  </svg>
                </span>
                <span className="hidden text-[15.5px] font-semibold tracking-tight sm:inline">Counsel</span>
              </Link>

              {/* Segmented control rather than a row of links: it reads as one
                  object, and the active state does not need colour to carry it.

                  Hidden here below `md` and rendered on its own row underneath
                  instead. Sharing the row with the logo, the Ask control and
                  the avatar left the nav 192px to hold 280px of links, so it
                  scrolled horizontally with no affordance and Contacts and
                  Companies sat off-screen: two of five destinations that did
                  not exist on a phone, in an app installed as a PWA. */}
              <nav className="hidden min-w-0 flex-1 justify-center md:flex lg:flex-none lg:justify-start">
                <div className="flex gap-0.5 rounded-xl border border-line bg-[var(--surface)] p-1">
                  <NavLinks links={NAV_LINKS} />
                </div>
              </nav>

              <div className="flex flex-none items-center gap-3 lg:ml-auto">
                <AskBox />
              </div>

              <div className="hidden flex-none items-center gap-3 lg:flex">
                {UTILITY_LINKS.map((l) => (
                  <Link
                    key={l.href}
                    href={l.href}
                    className="text-[12.5px] text-[var(--tx-3)] transition-colors hover:text-[var(--tx)]"
                  >
                    {l.label}
                  </Link>
                ))}
              </div>
              <form action={logout} className="flex-none">
                <button
                  type="submit"
                  title="Log out"
                  className="grid h-[30px] w-[30px] place-items-center rounded-full border border-line-2 bg-[var(--surface-2)] text-[11.5px] font-medium text-[var(--tx-2)] transition-colors hover:text-[var(--tx)]"
                >
                  DC
                </button>
              </form>
            </div>

            {/* The nav, on a row of its own, on phones only.
                Sharing the row above left it 192px to hold 280px of links, so
                it scrolled with no affordance and Contacts and Companies sat
                off-screen. Full width fits all five, and the targets reach the
                44px a thumb needs rather than the 32px a cursor tolerates. */}
            <nav className="mx-auto flex max-w-[1240px] gap-1 px-4 pb-2.5 md:hidden">
              <NavLinks links={NAV_LINKS} mobile />
            </nav>
          </header>
        )}
        <main className="mx-auto w-full max-w-[1240px] flex-1 px-4 pb-10 pt-5 sm:px-7">{children}</main>
        {/* Same gate as the header: the public landing and login pages get the
            chrome-free treatment, and the build a stranger is running is not
            their business either. */}
        {authenticated && <VersionFooter />}
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
