/**
 * Fills a demo database with an invented job search.
 *
 * Everything here is fabricated: the candidate, the employers, the recruiters,
 * the salaries, the email. **Nothing is Dan's**, which is the entire point -
 * this is what gets shown to other people, so it cannot contain a live
 * executive search, real recruiter names, or a real compensation conversation.
 *
 * The employers are invented rather than real brands. A demo full of Delta and
 * Marriott reads as more convincing for about five seconds and then becomes a
 * question about whether those companies endorsed anything, so the names here
 * are plausible and fictional.
 *
 * It is deliberately shaped like a real search in mid-flight rather than a
 * tidy one: roles at every stage, a couple of rejections, silence of different
 * ages so the follow-up cadence has something to say, one thread where the
 * candidate owes a reply and one where the employer does. A demo where nothing
 * needs doing shows none of the product.
 *
 *   DATABASE_URL="<demo db>" npx tsx --env-file=.env.demo scripts/seed-demo.ts
 *
 * REFUSES to run against a database that already holds real data, checked by
 * looking for the real profile, and refuses unless DEMO_MODE is set. Wiping
 * the live pipeline with a seed script is exactly the kind of accident this
 * file could otherwise cause.
 */
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const DAY = 86_400_000;
const ago = (d: number) => new Date(Date.now() - d * DAY);
const ahead = (d: number) => new Date(Date.now() + d * DAY);

const CANDIDATE = {
  name: "Alex Rivera",
  email: "alex.rivera.demo@example.com",
  phone: "555-0142",
};

async function main() {
  if (process.env.DEMO_MODE !== "1") {
    throw new Error("Refusing to seed: DEMO_MODE is not set. This would overwrite whatever database you are pointed at.");
  }

  const url = process.env.DATABASE_URL ?? "";
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

  // The strongest available signal that this is the wrong database. Volume
  // rather than a named employer: a demo database is seeded from empty, so
  // anything already carrying a real search has far more in it than this
  // script is about to write, and an owner means somebody claimed it.
  const existingRoles = await prisma.jobApplication.count();
  const owner = await prisma.owner.findFirst();
  if (existingRoles > 40 || owner) {
    throw new Error("Refusing to seed: this database holds real records. Point DATABASE_URL at the demo database.");
  }

  console.log("Clearing the demo database...");
  // Order matters: children before parents.
  await prisma.$transaction([
    prisma.askLog.deleteMany(),
    prisma.applicationAnswer.deleteMany(),
    prisma.activityLog.deleteMany(),
    prisma.followUp.deleteMany(),
    prisma.correspondence.deleteMany(),
    prisma.mailMessage.deleteMany(),
    prisma.interviewNote.deleteMany(),
    prisma.contact.deleteMany(),
    prisma.uploadedFile.deleteMany(),
    prisma.document.deleteMany(),
    prisma.evaluation.deleteMany(),
    prisma.jobDescription.deleteMany(),
    prisma.jobApplication.deleteMany(),
    prisma.company.deleteMany(),
    prisma.resumeVariant.deleteMany(),
    prisma.profile.deleteMany(),
  ]);

  await prisma.profile.create({
    data: {
      id: "singleton",
      contactName: CANDIDATE.name,
      contactPhone: CANDIDATE.phone,
      contactEmails: JSON.stringify([{ label: "job search", value: CANDIDATE.email }]),
      contactAddresses: JSON.stringify([{ label: "Metro", value: "Greater Boston Area" }]),
      contactLinks: "https://www.linkedin.com/in/example",
      defaultEmailLabel: "job search",
      defaultAddressLabel: "Metro",
      positioning:
        "Alex Rivera is a dual-lane executive. Lane 1 is marketing technology, digital and commercial platforms. " +
        "Lane 2 is technology delivery for revenue and customer systems. Both are first-class; roles reporting into " +
        "IT or Digital Technology are in scope.\n\nVerified metrics, and no others may be used or estimated: a " +
        "60-person organisation, a $300M+ marketing portfolio, the #2 revenue channel, 2M+ annual transactions, and " +
        "a 400-person agile transformation. A figure keeps the noun it is attached to.",
      careerNarrative:
        "Twelve years across airline and telecom commercial technology, most recently owning the martech and " +
        "ecommerce platform estate at a national carrier. Before that, nine years running digital delivery at a " +
        "cable operator, and an early agency decade.",
      standingPreferences:
        "Arial throughout. Two-page resume, at most 16 bullets, every bullet carrying a verified figure or a named " +
        "system. No em-dashes. Plain first-person voice.",
      evaluationFramework:
        "Score against both lanes. Auto-pass only for hands-on IC engineering, a hard CS-degree requirement, or " +
        "write-the-infrastructure roles.",
      personalLogistics: "Open to hybrid in the Northeast. Relocation considered for the right role.",
      // A JSON array, not prose: profile-context.ts and the Profile page both
      // JSON.parse this field. Seeding it as "None." made every AI route 500
      // with "Unexpected token N" - the failure surfaced nowhere near the seed.
      ruledOutCompanies: "[]",
    },
  });

  type RoleSpec = {
    company: string;
    role: string;
    status: string;
    salary?: string;
    verdict?: "swing" | "stretch" | "pass";
    /** Days since the candidate last wrote. Drives the follow-up cadence. */
    wroteAgo?: number;
    /** Days since a named person replied. */
    theyWroteAgo?: number;
    interviewIn?: number;
    interviewedAgo?: number;
    contact?: { name: string; role: string; email: string };
  };

  const ROLES: RoleSpec[] = [
    {
      company: "Meridian Airways",
      role: "Vice President, Digital & Commercial Platforms",
      status: "INTERVIEWING",
      salary: "$240,000 - $310,000",
      verdict: "swing",
      wroteAgo: 12,
      interviewedAgo: 15,
      contact: { name: "Priya Raman", role: "Principal Recruiter, Digital", email: "p.raman@meridianairways.example" },
    },
    {
      company: "Calder Retail Group",
      role: "VP, Marketing Technology",
      status: "INTERVIEWING",
      salary: "$225,000 - $280,000",
      verdict: "swing",
      wroteAgo: 9,
      theyWroteAgo: 2,
      interviewIn: 3,
      contact: { name: "Tom Alderidge", role: "Talent Partner", email: "t.alderidge@calderretail.example" },
    },
    {
      company: "Northgate Financial",
      role: "Senior Director, Customer Data Platform",
      status: "APPLIED",
      salary: "$210,000 - $265,000",
      verdict: "stretch",
      wroteAgo: 8,
      contact: { name: "Dana Whitfield", role: "Executive Search Consultant", email: "d.whitfield@northgatefin.example" },
    },
    {
      company: "Harborline Hotels",
      role: "VP, Guest Digital Experience",
      status: "APPLIED",
      salary: "$195,000 - $250,000",
      verdict: "swing",
      wroteAgo: 4,
      contact: { name: "Marcus Bell", role: "Corporate Recruiter", email: "m.bell@harborlinehotels.example" },
    },
    { company: "Volta Energy", role: "Head of Digital Enablement", status: "APPLIED", salary: "$205,000 - $255,000", verdict: "stretch" },
    { company: "Stellan Foods", role: "VP Marketing / MarTech", status: "LIVE_POSTING_FOUND", verdict: "swing" },
    { company: "Aperture Media", role: "VP, Campaign Planning & Operations", status: "LIVE_POSTING_FOUND", verdict: "stretch" },
    { company: "Bright Harbor Health", role: "Director, Marketing Operations", status: "LIVE_POSTING_FOUND" },
    { company: "Kestrel Logistics", role: "Senior Director, Commercial Systems", status: "TARGET" },
    { company: "Ossington Brands", role: "VP, Ecommerce", status: "VERIFY" },
    { company: "Pinewell Insurance", role: "VP, Digital Experience", status: "CLOSED_REJECTED", verdict: "stretch" },
    { company: "Trellis Software", role: "Director, Lifecycle Marketing", status: "CLOSED_REJECTED" },
    { company: "Cobalt Airlines", role: "Head of Loyalty Technology", status: "PASSED", verdict: "pass" },
  ];

  console.log(`Seeding ${ROLES.length} roles...`);

  for (const spec of ROLES) {
    const company = await prisma.company.create({ data: { name: spec.company } });
    const app = await prisma.jobApplication.create({
      data: {
        companyId: company.id,
        roleTitle: spec.role,
        status: spec.status,
        salaryRange: spec.salary ?? null,
        lastCheckedAt: ago(Math.floor(Math.random() * 10) + 1),
        notes: spec.status === "CLOSED_REJECTED" ? "Rejected at screening stage." : null,
      },
    });

    if (spec.verdict) {
      await prisma.jobDescription.create({
        data: {
          applicationId: app.id,
          rawText:
            `${spec.company} is hiring a ${spec.role}. You will own the marketing technology stack, partner with ` +
            `engineering on the customer data platform, and lead a team responsible for campaign delivery and ` +
            `measurement. Requires 10+ years of experience and a track record running large platform programmes.`,
          pastedAt: ago(20),
        },
      });
      await prisma.evaluation.create({
        data: {
          applicationId: app.id,
          recommendation: spec.verdict,
          fitSummary:
            spec.verdict === "pass"
              ? "This is a loyalty-platform engineering role rather than a commercial technology role, and the core competencies are not a match."
              : `Strong overlap with the platform ownership and the commercial measurement side. ${
                  spec.verdict === "stretch" ? "The industry is new, which makes this a stretch rather than a straight swing." : ""
                }`,
          strengths: JSON.stringify([
            "Owned a $300M+ marketing portfolio, well above the scale this role describes.",
            "Ran the #2 revenue channel end to end, including the platform behind it.",
            "Led a 400-person agile transformation across marketing and delivery.",
          ]),
          gaps: JSON.stringify([
            "No direct sector experience, which the posting mentions twice.",
            spec.salary ? "Range tops out below the target." : "No published range.",
          ]),
          model: "claude-opus-5",
          generatedAt: ago(19),
        },
      });
      await prisma.document.create({
        data: {
          applicationId: app.id,
          type: "resume",
          content:
            `## ${CANDIDATE.name}\n\n### Meridian Airways | national carrier :: 2019 - present\n` +
            `#### Vice President, Digital & Commercial Platforms :: 2022 - present\n` +
            `> Marketing Technology · Ecommerce · Analytics · Delivery\n` +
            `- **Owned a $300M+ marketing portfolio**, covering platform, agency and measurement.\n` +
            `- **Ran the #2 revenue channel**, 2M+ annual transactions through the commerce stack.\n` +
            `- **Led a 400-person agile transformation** across marketing and delivery.\n`,
          model: "claude-opus-5",
          generatedAt: ago(18),
        },
      });
    }

    if (spec.contact) {
      const contact = await prisma.contact.create({
        data: {
          applicationId: app.id,
          company: spec.company,
          name: spec.contact.name,
          role: spec.contact.role,
          email: spec.contact.email,
          relationship: "Recruiter on this role",
        },
      });

      if (spec.wroteAgo !== undefined) {
        await prisma.correspondence.create({
          data: {
            applicationId: app.id,
            contactId: contact.id,
            type: "general",
            recipientName: spec.contact.name,
            recipientEmail: spec.contact.email,
            subject: `${spec.role} - following up`,
            content: `Hi ${spec.contact.name.split(" ")[0]},\n\nThanks again for your time. Happy to answer anything else that would help.\n\nBest,\n${CANDIDATE.name}`,
            status: "sent",
            sentAt: ago(spec.wroteAgo),
            gmailMessageId: `demo-${app.id}`,
          },
        });
      }

      if (spec.theyWroteAgo !== undefined) {
        await prisma.mailMessage.create({
          data: {
            gmailId: `demo-in-${app.id}`,
            fromEmail: spec.contact.email,
            fromName: spec.contact.name,
            subject: `Re: ${spec.role}`,
            snippet: "Thanks for the detail. Are you free later this week for a follow-up conversation?",
            body: "Thanks for the detail. Are you free later this week for a follow-up conversation?",
            receivedAt: ago(spec.theyWroteAgo),
            direction: "received",
            applicationId: app.id,
            category: "interview_invite",
            summary: `${spec.contact.name} asks about availability for a follow-up conversation.`,
          },
        });
      }
    }

    if (spec.interviewIn !== undefined) {
      await prisma.interviewNote.create({
        data: { applicationId: app.id, roundName: "Hiring manager", date: ahead(spec.interviewIn), notes: "" },
      });
    }
    if (spec.interviewedAgo !== undefined) {
      await prisma.interviewNote.create({
        data: {
          applicationId: app.id,
          roundName: "Round 1 - recruiter screen",
          date: ago(spec.interviewedAgo),
          notes: "Went well. They described the team as newly formed and still hiring into it.",
        },
      });
    }
  }

  // One person with no role behind them: the networking case the app exists to
  // keep hold of.
  await prisma.contact.create({
    data: {
      name: "Erin Castillo",
      email: "e.castillo@lattice-partners.example",
      company: "Lattice Partners",
      role: "Managing Partner",
      relationship: "Networking introduction",
      notes: "Introduced by a former colleague. No specific role; worth staying in touch.",
      nextAction: "Send the intro note and suggest a call.",
    },
  });

  // One unfiled message, so the Inbox has something to demonstrate.
  await prisma.mailMessage.create({
    data: {
      gmailId: "demo-unfiled-1",
      fromEmail: "s.okafor@vantagegroup.example",
      fromName: "Sam Okafor",
      subject: "Quick introduction",
      snippet: "A colleague suggested I reach out about a role we are shaping.",
      body: "A colleague suggested I reach out about a role we are shaping on the commercial technology side. Would you be open to a short call?",
      receivedAt: ago(1),
      direction: "received",
      category: "recruiter_outreach",
      detectedCompany: "Vantage Group",
      summary: "Sam Okafor at Vantage Group asks about a short call regarding a commercial technology role being shaped.",
    },
  });

  const counts = {
    roles: await prisma.jobApplication.count(),
    companies: await prisma.company.count(),
    contacts: await prisma.contact.count(),
    documents: await prisma.document.count(),
    mail: await prisma.mailMessage.count(),
  };
  console.log("Done:", counts);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
