/**
 * What each release actually did for the person using the app.
 *
 * `changelog.json` is `git log`, which says what changed in the code. It does
 * not say what became possible, and those are different questions: "Match
 * calendar events to people, not just companies" is accurate and tells you
 * nothing about the 4:30 coffee that was missing from Today. A release history
 * made only of commit subjects is a record for whoever wrote them.
 *
 * So each entry is the user-facing half, written as a story, with the problem
 * that prompted it. Keyed on the ship message rather than a sha, for two
 * reasons: the shipping commit is never in its own log (the generator runs
 * before the commit exists), and merging to `production` rewrites shas anyway.
 * The subject is what both sides can see.
 *
 * `scripts/ship.sh` refuses to ship a subject with no story here unless it is
 * given `--no-story`, because a habit that depends on remembering is not a
 * habit. Same reasoning as the lint and audit gates in that script.
 */

export type StoryArea =
  | "Today"
  | "Pipeline"
  | "Correspondence"
  | "Contacts"
  | "Inbox"
  | "Documents"
  | "Calendar"
  | "Applying"
  | "Craft";

export type Story = {
  /** The `ship.sh` message this went out under. */
  subject: string;
  area: StoryArea;
  /** The capability, in plain words. */
  title: string;
  /** As <someone>, I want <capability>, so that <outcome>. */
  story: string;
  /** What was wrong before. The reason the story was worth writing. */
  problem: string;
  /**
   * A fix somebody should take now rather than when convenient.
   *
   * Reserved for data loss, a security problem, or something that quietly
   * produces a wrong document: the cases where running the old version is
   * actively worse than updating. An instance that has chosen not to
   * auto-update still gets told about these differently, and the word means
   * nothing if it is used for a good feature.
   */
  critical?: boolean;
};

export const STORIES: Story[] = [
  {
    subject: "Invite somebody to an instance you cannot read",
    area: "Craft",
    title: "One email sets somebody up, on their accounts, under stated terms",
    story:
      "As somebody handing this to former colleagues, I want to send one email that sets them up on their own infrastructure under terms they have accepted, so that giving it away costs me nothing and promises them something true.",
    problem:
      "Handing the app to somebody meant either hosting them, which quietly makes their job search readable to me, or sending a bare link with no terms and no explanation. There is now a LICENSE, which is the actual instrument: the software stays the author's, a single personal instance is permitted, redistribution and commercial use are not. Claiming an instance requires accepting it, checked in the library rather than only in the form, and recorded with a timestamp and the version of the text that was shown. Beside it sits the reciprocal statement, which is only true because they deployed it themselves: the database is theirs and the author holds no credentials to it. Feedback needed no configuration either - a self-deployed instance defaults to reporting upstream, so the one channel back from the people most likely to hit a bug is open rather than silently absent.",
  },
  {
    subject: "Prompts stop naming one person",
    area: "Craft",
    title: "Your mail is signed with your name, not somebody else's",
    story:
      "As somebody running my own copy, I want everything the app writes to be about me, so that a drafted email goes out under my name rather than the name of whoever built it.",
    problem:
      "Seven live prompts carried a hardcoded name, and the worst instructed the model to sign a recruiter email off with it: on anybody else's instance, their outgoing mail would have been signed by somebody they have never met. Others told the assistant whose job search it was managing and used gendered pronouns throughout. All of it reads from the profile now, deduped per request. Found only because a privacy sweep happened to match the same string, which is worth noting: this was never a privacy problem, it was the employer-list bug wearing a different hat, and nothing was looking for it.",
    critical: true,
  },
  {
    subject: "Close the two routes the gate could not see",
    area: "Craft",
    title: "The guard stops publishing the list it guards",
    story:
      "As somebody publishing this repository, I want the checks that keep private detail out to not themselves contain that detail, so that turning the guard on is not the leak.",
    problem:
      "Building the export surfaced two routes past the new check. The check itself held the pattern list in source, so publishing the guard would have published the exact names it exists to keep out. And the committed changelog carried thirty commit bodies naming real employers and people, which render on the releases page: a commit subject is not a file, so no file-scanning gate could ever see it. Patterns now live in an uncommitted file and the check no-ops without it, which is right for a clone with nothing to protect. The changelog is redacted, and ship.sh refuses a commit subject naming anyone before it reaches the log. Verified by planting a name and watching each gate catch it.",
  },
  {
    subject: "Release history survives a change of repository",
    area: "Craft",
    title: "Moving the code does not erase what shipped before",
    story:
      "As somebody moving this to a fresh repository, I want the release notes to keep everything that shipped before the move, so that a change of address does not read as the project having started yesterday.",
    problem:
      "The changelog is frozen from git log at build time, because the deploy container has no history to read. That is fine until the history itself changes: publishing from a repository re-created with a clean first commit would have regenerated the file from one commit and silently discarded two hundred releases. The generator merges now rather than replacing, keyed on sha, with git winning any collision. Verified against the real case by building a one-commit repository and confirming the count came back 201 rather than 1.",
  },
  {
    subject: "Make identifying detail a gate, not a grep",
    area: "Craft",
    title: "The repo cannot quietly regain somebody's private details",
    story:
      "As somebody about to publish this, I want a check that fails the ship when a real recruiter, employer or contact detail appears anywhere in the code, so that whether it is safe to publish is answered by a gate rather than by somebody reading grep output.",
    problem:
      "The same question was answered clean twice and was wrong both times. The first sweep was case-sensitive, so shouted forms survived. The second had quietly dropped the employer names from its pattern list and only looked for people. About fifty occurrences were still there, including the placeholder text inside the Ask box, which is on screen. Both sweeps were done by grepping and reading the output, which this codebase already says is not a gate: the story gate and the lint gate exist for exactly this reason. It is check nineteen in the audit now, so ship.sh refuses. Three of the occurrences were load-bearing rather than prose - the demo seed guard keyed on an employer domain to detect a real database, and two comments documented literal string matching - so those were rewritten by hand rather than substituted.",
  },
  {
    subject: "The release notes stop naming people",
    area: "Craft",
    title: "Release history that can be read by anybody",
    story:
      "As somebody who wants former colleagues to use this app, I want its release notes to describe what changed without naming the recruiters and companies involved, so that showing the project is not the same as publishing my search.",
    problem:
      "The release page named nine real people and every employer applied to, because each story explained a bug by describing the day it happened. A calendar fix was explained by naming two people on an invite; a filing fix by naming a VP and their employer. The lesson never depended on the identity: an event titled with two people's names and no company matched nothing, which is the whole point, and reads better without a name attached. Rewritten by hand rather than substituted, after find-and-replace on the same content produced sentences that were both ungrammatical and, in one file documenting literal string comparison, factually wrong.",
  },
  {
    subject: "Split the working notes from the engineering rules",
    area: "Craft",
    title: "The project can be shown to somebody without showing them a job search",
    story:
      "As somebody who wants to hand this app to former colleagues, I want the repository to contain the code and its rules and nothing about my search, so that sharing the project is not the same act as publishing who I am talking to.",
    problem:
      "The main working document had grown to 2,218 lines and had become two documents wearing one name. Underneath the engineering rules, which are general and worth publishing, sat the case notes that produced them: nine named recruiters and former colleagues, every employer applied to, which ones said no, and personal contact details. None of it was read by the app. Splitting it left 308 lines of rules that read better without the anecdotes, and moved the specifics to a file that does not ship. Two shortcuts were tried first and both were worse than doing it properly: inventing stand-in people, which fills a real history with false ones, and find-and-replace, which produced sentences like 'CNN is a a media conglomerate property' and silently corrupted documentation of literal string matching.",
  },
  {
    subject: "One deploy path, and one copy of the code behind it",
    area: "Craft",
    title: "A friend can own their own instance and their own data",
    story:
      "As somebody being given this app, I want it deployed on my own accounts, so that the person who gave it to me cannot read my job search even if they wanted to.",
    problem:
      "Provisioning put every instance on the operator's Vercel and Neon accounts. The application-layer isolation was real and beside the point: as owner of the database he could open the Neon console and read anybody's applications, contacts and correspondence. A deploy button with a mandatory Neon integration puts the whole thing on their account instead, which makes the privacy claim a fact about who holds the credentials rather than a promise about intentions. It needs the repository public, and one pasted secret that cannot be auto-generated because the auth gate runs in the Edge runtime where Prisma cannot read a database.",
  },
  {
    subject: "People can ask for things, and asking reaches the work",
    area: "Craft",
    title: "A request someone makes turns into work without being remembered",
    story:
      "As somebody running a copy of this, I want to ask for a feature and have it actually reach whoever builds it, so that telling them is not a message that gets lost in a thread.",
    problem:
      "There was no way for anybody using a handed-out instance to say anything. Requests now travel from their deployment to the operator's, arrive as an email and a row to approve, queue or decline, and anything approved becomes a backlog a session reads before starting. That last step is the point: the alternative was Dan remembering to mention it, which is the same fault the story gate exists to prevent. It is also the only thing in the app that crosses between instances, so it sends exactly the words somebody typed and nothing about their search, and the page says so before they press send.",
  },
  {
    subject: "Instances are pinned, and updated on purpose",
    area: "Craft",
    title: "Nothing you push reaches anybody until you say so",
    story:
      "As somebody handing copies of this to other people, I want each instance frozen on a version until I push an update, so that a commit I made this morning does not silently rebuild everybody.",
    problem:
      "Provisioned instances were git-connected, so every push to production redeployed all of them at once. Thirty instances meant thirty of the hundred daily deployments spent without a decision, one bad commit breaking everyone simultaneously, and the app's own promise that an instance does not update by itself made false for exactly the people it was told to. Instances are created with no git link now, pinned to a commit, and the Instances page says which of them are behind and pushes the version this deployment is actually running.",
  },
  {
    subject: "Provision a whole instance with one command",
    area: "Craft",
    title: "Setting somebody up stops being a fifteen-minute ritual",
    story:
      "As somebody handing this to a friend, I want one command that creates the database, the project and the deployment, so that giving somebody an instance is not an afternoon of clicking.",
    problem:
      "Doing it by hand had four traps, and the first real run hit all of them: vercel.com/new pushes you into an AI flow with no visible exit, an empty DATABASE_URL left behind by the import screen blocks the database integration, the integration then offers a Custom Prefix that produces a variable the app never reads, and the first deploy has to fail before a database can be attached at all. Every one of those is an artifact of the web UI. The API can set environment variables in the same call that creates the project, so the real connection string is there from the first byte and there is nothing to collide with, nothing to delete and no failed deploy.",
  },
  {
    subject: "Only a production deploy may migrate the database",
    area: "Craft",
    title: "Pushing a branch cannot change the live schema",
    story:
      "As somebody whose preview environment points at the real database, I want migrations to run only on a production deploy, so that pushing a branch never alters the data my job search lives in.",
    problem:
      "Applying migrations during the build fixed fresh deployments and introduced a worse hazard on this one: preview shares the production database, so any push, including from a phone, would have silently applied a schema change to live data before anybody looked at the preview. A preview carrying a new migration now fails against the old schema instead, which is the right place for it to fail.",
    critical: true,
  },
  {
    subject: "A fresh deployment creates its own tables",
    area: "Craft",
    title: "A new instance comes up working, not 500ing",
    story:
      "As somebody deploying my own copy, I want the database set up as part of the deploy, so that the first page I open is the app rather than an error.",
    problem:
      "Nothing ever ran `prisma migrate deploy`. The live schema existed because migrations were run by hand from a laptop, which works for exactly one person and hides the fault completely: a fresh deployment against a new database builds fine, starts fine, and returns a 500 on every page because there are no tables. The one person who could never see it is the person migrating by hand. The build now applies migrations on Vercel, and a failed migration stops the build rather than shipping an app whose schema does not match its code.",
    critical: true,
  },
  {
    subject: "A fresh deployment creates its own tables",
    area: "Craft",
    title: "Instructions somebody can actually follow",
    story:
      "As somebody handed a link to this, I want a short list of steps that ends with a working instance, so that I do not have to read the source to work out what it needs.",
    problem:
      "The README said every key in .env.example was required and that Google OAuth was how you signed in. Neither had been true since credentials moved into the app: only DATABASE_URL and SESSION_SECRET are needed, and everything else switches on a capability. Stale setup instructions are worse than none, because they send somebody to configure an OAuth consent screen they do not need.",
  },
  {
    subject: "Set an instance up from the web, with your own career in it",
    area: "Craft",
    title: "Sign in without a Google Cloud project",
    story:
      "As somebody handed a copy of this app, I want to set a password and be inside, so that using it does not begin with fifteen minutes of console work on a cloud platform I did not ask for.",
    problem:
      "Sign-in was Google OAuth locked to one address, so a new person had to create a Google Cloud project, configure a consent screen and register a redirect URI for their own deployment before they could see a single screen. Demo mode had proved a password works the whole time. Google is now an optional mail integration rather than the front door, and an instance with ALLOWED_EMAIL set can never be claimed by whoever finds the URL.",
  },
  {
    subject: "Set an instance up from the web, with your own career in it",
    area: "Craft",
    title: "Setup asks eight questions instead of six essays",
    story:
      "As somebody starting from an empty instance, I want to answer questions I can answer out loud and paste my resume, so that the app writes its own long-form profile and I correct it rather than composing it.",
    problem:
      "A working instance holds about 56,000 characters of career prose across six profile fields and four resume variants, roughly nine thousand words, and setup asked for all of it as blank boxes. Nobody fills that in, and a half-filled profile is worse than an empty one because every fit verdict and every document is grounded in it: the output is confident, well formatted and wrong rather than obviously broken.",
  },
  {
    subject: "Set an instance up from the web, with your own career in it",
    area: "Documents",
    title: "Cover letters finally have a base, like resumes do",
    story:
      "As somebody who has already written a letter I am happy with, I want the app to write in that voice, so that what comes out sounds like me instead of like the average of a prompt.",
    problem:
      "Resumes were tailored from four base variants. The cover letter had no base at all: it was assembled from profile prose plus whichever resume variant was picked plus the job description, so its register was whatever the model reached for that run, and the only way to correct it was adding another banned phrase to a list. A sample letter is now read as a voice reference, and the prompt states explicitly that every company, figure and claim inside it belongs to a different application and may not be reused.",
  },
  {
    subject: "Set an instance up from the web, with your own career in it",
    area: "Documents",
    title: "The app stops assuming everyone shares one career",
    story:
      "As somebody running my own copy, I want documents built from my career, so that nothing is written that quietly asserts a job I never had.",
    problem:
      "One person's employers were constants in the source. A hardcoded array listed them, the generation prompt named one and told the model to put it first, the reviewer checked that same instruction as house style, and the introduction letter was told to name two of them by hand. On anyone else's instance that produces a confident, well-formatted lie about their career, and nothing throws. Employers are read off the resume itself now. Comparing the two showed why: the hardcoded list was both stale, naming an employer that appeared in no resume variant, and incomplete, missing one that did.",
  },
  {
    subject: "File mail to a person, not just a role or company",
    area: "Inbox",
    title: "File a message to the person it is about",
    story:
      "As someone whose best leads arrive through people rather than postings, I want to file a message against a person even when there is no job behind it, so that when a role does appear the history is already attached to whoever introduced me.",
    problem:
      "Filing offered a role or an employer and nothing else. A networking thread with a VP at a retailer, arranging a conversation with no requisition anywhere near it, could only be filed to the company, so the person who made the introduction held none of the conversation.",
  },
  {
    subject: "Match calendar events to people, not just companies",
    area: "Calendar",
    title: "Meetings named after a person reach Today",
    story:
      "As someone who books as many conversations as interviews, I want a meeting titled with somebody's name to show up on Today, so that a coffee with a VP is as visible as a formal interview round.",
    problem:
      "Calendar matching only ever asked which employer an event belonged to. An event titled with two people's names and no company matched nothing, so a 4:30 conversation that same afternoon was missing from the page whose whole job is saying what is happening today.",
  },
  {
    subject: "Queue rows land on the thing they name, not near it",
    area: "Today",
    title: "Every row on Today opens the thing it promises",
    story:
      "As someone working through a short list of things that need me, I want each row to open exactly what it describes, so that acting on it takes one click rather than a hunt.",
    problem:
      "A row reading 'draft to this person not sent yet' opened the role page instead of the draft: the right company, several clicks from the sentence it had just promised. 'No prep built' opened the role rather than the page that builds prep, and every cadence row opened the wrong tab.",
  },
  {
    subject: "Asking Claude for a different subject changes the subject",
    area: "Correspondence",
    title: "Ask for a new subject line and get one",
    story:
      "As someone drafting a note with Claude, I want asking for a different subject to change the subject, so that the instruction box governs the whole message and not just the body.",
    problem:
      "Two faults stacked. On any thread the model was told to return the body only and no subject line, and the composer discarded a returned subject whenever its box already had one. Asking for a different subject did nothing at all, silently.",
  },
  {
    subject: "Suppress the subject only when one can actually be inherited",
    area: "Correspondence",
    title: "A new note always arrives with a subject",
    story:
      "As someone writing to a contact who has never written back, I want the draft to come with a subject already filled in, so that I never send an untitled note or have to invent one.",
    problem:
      "The rule counted my own sent notes as a thread, while the fallback subject was read only off incoming mail. For three contacts I had written to who had not replied, the subject box stayed empty permanently and nothing explained why.",
  },
  {
    subject: "A booked meeting sets the stage, and datetime-local is read as Eastern",
    area: "Calendar",
    title: "Booking a meeting moves the role to Interviewing, at the right time",
    story:
      "As someone whose pipeline should reflect reality, I want scheduling a meeting to move the role to Interviewing by itself and to store the time I actually agreed, so that neither the stage nor the hour depends on me correcting it.",
    problem:
      "An interview invitation was classified as recruiter outreach, so the role sat on Applied with a call already booked for the next morning. Worse, the confirmation form showed 1:30pm and saved 9:30am, because a datetime-local value carries no timezone and was read as UTC.",
  },
  {
    subject: "Pipeline controls stay on the pipeline",
    area: "Pipeline",
    title: "Search, filter and sort without being thrown off the page",
    story:
      "As someone looking for one role among sixty, I want to type in the search box and stay on the pipeline, so that finding something does not cost me my place.",
    problem:
      "The controls were written when the pipeline was the home page and still pushed a hardcoded '/'. Typing anything waited 350ms and then threw you onto Today. The status filter and the sort dropdown did the same.",
  },
  {
    subject: "A Workday page: the resume as the fields their parser mangles",
    area: "Applying",
    title: "Every Workday field, ready to copy",
    story:
      "As someone applying through Workday, I want my career already broken into their boxes with a copy button on each, so that a parser that mangles my resume costs me a few clicks rather than twenty minutes of retyping.",
    problem:
      "Workday's resume parser garbles the upload every time, so each application meant retyping the same career by reading it off a PDF, even though the facts were sitting structured in the resume variants the whole time.",
  },
  {
    // British spelling, and it stays. This is the git commit subject, which is
    // immutable history and the key `storyFor` matches on. Ship messages from
    // here on are US English like everything else.
    subject: "US spelling: fix the sources, and the two bugs in the normaliser",
    area: "Craft",
    title: "British spellings cannot reach an employer",
    story:
      "As someone applying to US employers, I want every surface that shows my words to enforce US spelling, so that a spelling in a source file can never turn up in front of a hiring manager.",
    problem:
      "The resume variants carried 'traveller' and 'centre'. Generated documents were clean because generation normalizes, but the new Workday page read the variants raw. The normalizer itself had two bugs: it rewrote SPECIALIST as SpecialisT and would have turned 'centred' into 'centerd'.",
  },
  {
    subject: "Audit: house rules on employer answers, one timezone, one person test",
    area: "Craft",
    title: "The house rules hold on every outward path",
    story:
      "As someone whose written voice is part of how I am judged, I want the same rules applied everywhere text leaves the app, so that consistency does not depend on which screen I happened to use.",
    problem:
      "Application form answers, which are pasted directly into employer portals, were the one outward route with no house-language enforcement. Nothing had gone out yet. The sweep also found the timezone named in four places and the test for 'is this a person' defined twice.",
  },
  {
    subject: "A style guide, and every release carries a story",
    area: "Craft",
    title: "A style guide that cannot go stale, and releases that say what they did",
    story:
      "As someone who will show this app to other people, I want a written style guide and a release history in plain language, so that the rules are inspectable and the log reads as capabilities rather than commit subjects.",
    problem:
      "The house rules lived only in prompts, code and a very long CLAUDE.md, and the release page was a list of commit subjects. Neither could be handed to anyone. A guide that restated its rules would have become a second source of truth and drifted, which is the exact fault it would be documenting.",
  },
  {
    subject: "US spelling in the app's own interface, not just what it sends",
    area: "Craft",
    title: "The interface holds itself to the same spelling rule",
    story:
      "As someone who will show this app to other people, I want its own screens to follow the US spelling rule it enforces on my documents, so that the tool does not visibly break the standard it is selling.",
    problem:
      "Enforcement only ever covered text sent outward. The interface was never checked, and whoever writes it defaults to British English, so the style guide shipped with a section header reading 'Colour'. Dan found it on the page whose entire subject is that rule.",
  },
  {
    subject: "Tests, CI, and a date bug the compiler now catches",
    area: "Craft",
    title: "The checks are real, and they run somewhere other than one laptop",
    story:
      "As someone who wants to trust this app with a live job search, I want its rules covered by tests that actually run, so that a change cannot quietly break the cadence, the mail rules or an interview time.",
    problem:
      "There were no tests at all, and CLAUDE.md claimed several rules were tested when each had only been a script run once and deleted. Nothing ran off Dan's machine either, so merging in the GitHub UI skipped every gate. The date bug that moved an interview four hours was caught by a regex check whose first run produced three false positives.",
  },
  {
    subject: "Quiet failures are recorded, and the lint gate actually fires",
    area: "Craft",
    title: "Background work that fails is findable instead of merely absent",
    story:
      "As someone relying on this app to file, sync and advance things in the background, I want anything that fails quietly to be recorded and visible, so that a capability which has stopped working is something I can find rather than something I eventually notice missing.",
    problem:
      "44 catch blocks swallowed errors with no logging and no reporting anywhere. A Drive sync failing for a week looked exactly like a quiet week. Separately, the lint gate in ship.sh had never once fired: pipefail made it false precisely when eslint found errors, and a set-state-in-effect error had already shipped through it.",
  },
  {
    subject: "Cache the profile prefix on every model call",
    area: "Craft",
    title: "The same context is not paid for twice",
    story:
      "As someone paying for every evaluation, draft and review out of my own API credits, I want the unchanging part of each prompt cached, so that running the app costs what the new thinking costs rather than re-billing my whole profile each time.",
    problem:
      "All twelve AI routes sent the Profile row as their system prompt, several thousand tokens of positioning, narrative and standing preferences, identical every call. It was appended at the END of each prompt, so no two requests shared a prefix and nothing could cache. Anthropic's own report put the waste at up to 43% of direct API spend, on the same day the credits ran out.",
  },
  {
    subject: "The model picker actually picks the model",
    area: "Craft",
    title: "Choosing Gemini sends the request to Gemini",
    story:
      "As someone who switches models when one provider is unavailable or expensive, I want the picker to change where the request goes, so that choosing an alternative is a real fallback rather than a relabelled failure.",
    problem:
      "Thirteen of eighteen AI routes built their own Anthropic client and never consulted the provider router, so on those routes the dropdown changed the label and nothing else. Dan found it by switching interview prep to Gemini when the Claude balance ran out and getting an Anthropic billing error back.",
  },
  {
    subject: "Try the default, fall back to Gemini when Anthropic is dry",
    area: "Craft",
    title: "One provider running out does not stop the search",
    story:
      "As someone whose job search does not pause for a billing problem, I want the app to try my preferred model and quietly switch to Gemini when Anthropic is unavailable, so that a balance hitting zero costs me nothing but a slightly different model.",
    problem:
      "The fallback existed and could not fire. Most routes built their own Anthropic client and never consulted the router, generateText had no fallback at all, and the one that did fall back chose the cheapest Gemini model for work that goes to an employer under Dan's name.",
  },
  {
    subject: "Interview prep belongs with the documents",
    area: "Documents",
    title: "Interview prep sits on Work, with everything else you generate",
    story:
      "As someone getting ready for an interview, I want the prep document where the other generated documents are, so that I look in one place for anything the app wrote for me.",
    problem:
      "Prep was filed under Talk because it is about a conversation. The tabs sort by kind of thing rather than by topic, and prep is generated, versioned, downloadable and synced to Drive, which describes everything on Work and nothing on Talk.",
  },
  {
    subject: "One type scale, so pages stop changing size",
    area: "Craft",
    title: "Page titles are the same size on every page",
    story:
      "As someone moving between Pipeline, Contacts and Companies all day, I want the type to hold still, so that switching pages does not feel like switching applications.",
    problem:
      "Four different page-title treatments across nine pages, and three ledes under them. No single page looked wrong, which is why it survived: the drift is only visible in the transition. Toggling Pipeline, Contacts and Companies went 40, 46, 40 on desktop and Dan felt it.",
  },
  {
    subject: "Sync the mail even when the classifier cannot run",
    area: "Inbox",
    title: "Syncing the inbox works without a model",
    story:
      "As someone who needs to see recruiter mail regardless of an API balance, I want the sync to pull my messages even when no model is available, and to sort them on the next run, so that a billing problem never costs me the mail itself.",
    problem:
      "Sync classified every message with Claude and returned an error if that failed, so a dry balance meant no mail at all rather than unsorted mail. It reported an Anthropic billing error from the Inbox page, where nothing about the action suggests a model is involved.",
  },
  {
    subject: "One input, one radius, two page widths",
    area: "Craft",
    title: "The interface stops changing shape between pages",
    story:
      "As someone using this all day, I want controls and page widths to hold still, so that moving between pages does not feel like moving between applications.",
    problem:
      "A full sweep found seventeen spellings of a text input, eleven border radii including three arbitrary values a pixel or two off the scale, and four page container widths. Two pages had lost their mx-auto and hugged the left edge while their siblings centered. None of it looked wrong on any single page, which is why it survived being looked at.",
  },
  {
    subject: "A visible focus ring, two empty states, one section rhythm",
    area: "Craft",
    title: "You can see where the keyboard is",
    story:
      "As someone who moves through forms with the keyboard, I want to see which field I am in, so that filling anything out does not depend on guessing.",
    problem:
      "Form fields killed the outline and replaced it with a ring in the same color as the field background. Measured, that is 1.00:1 contrast: not faint, invisible. Buttons and links had a proper ring all along, so fields were the only thing missing one. The same sweep found fourteen stylings for eighteen empty states and five different gaps above a page section.",
  },
  {
    subject: "The phone nav shows all five destinations",
    area: "Craft",
    title: "Every part of the app is reachable on a phone",
    story:
      "As someone who uses this as an installed app on an iPhone, I want every destination visible and tappable, so that the phone version is the whole app rather than the first three things that fit.",
    problem:
      "The nav shared a row with the logo, the Ask control and the avatar, which left it 192px to hold 280px of links. It scrolled horizontally with nothing indicating that it could, so Contacts and Companies sat off-screen: two of five destinations that effectively did not exist on a phone. Targets were 32px against the 44px a thumb needs.",
  },
  {
    subject: "Errors look like errors, in one shape and a real color",
    area: "Craft",
    title: "A failure reads the same wherever it happens",
    story:
      "As someone who hits an error and needs to understand it fast, I want failures to look the same everywhere and to stay legible in either theme, so that the message is the only thing I have to work out.",
    problem:
      "Thirteen error stylings across twenty-four places, in three different reds, some tinted and some bare. All of them were hardcoded Tailwind reds because the palette had no error color at all: it had amber for 'needs attention' and nothing for 'this failed', so a warning and a failure shared one meaning. In dark mode the tinted ones rendered as a bright pink block.",
  },
  {
    subject: "The spelling pass cannot rename a company",
    area: "Craft",
    title: "Employer names survive the house style",
    story:
      "As someone writing to employers whose names contain the exact words the normalizer targets, I want their names left exactly as they spell them, so that a letter never renames the company it is addressed to.",
    problem:
      "enforceHouseLanguage rewrote any word it recognized and could not tell the writer's own prose from an employer's name. A Canadian employer in the pipeline spells a word in its own department names the way the normalizer was built to correct, and was actively interviewing at the time. Nothing had been renamed yet, which is the only reason this is a precaution rather than a retraction.",
  },
  {
    subject: "One data layer, one tenant, one header block",
    area: "Craft",
    title: "The soft-delete rule lives in one place, and headings sit at the same height",
    story:
      "As someone whose pipeline must never show a role I deleted, I want that rule defined once rather than copied into every query, and I want pages to stop shifting vertically as I move between them.",
    problem:
      "The soft-delete filter was hand-written in sixteen places across eight files, which is why the audit needed a check for it: there was nowhere to centralize it. The tenant id was a bare string in twenty files, so nothing named the single-tenant design or enforced it. And the block above each page title had four different paddings, so titles physically sat lower on some pages.",
  },
  {
    subject: "Every page opens the same way",
    area: "Craft",
    title: "A heading and a line saying what the page is for",
    story:
      "As someone moving between pages all day, I want each one to open the same way, so that the app reads as one thing rather than a set of screens built at different times.",
    problem:
      "Two competing header patterns had grown up: a page name with an explanation, and a bare statement with nothing under it. Inbox had a line but only when there was mail, so clearing the inbox removed it and the page jumped. Contacts and Follow-ups had none at all.",
  },
  {
    subject: "Every AI feature survives a dead balance except one",
    area: "Craft",
    title: "The whole app keeps working when a provider runs out",
    story:
      "As someone whose search does not pause for a billing problem, I want every AI feature to fall back to my other provider automatically, so that running out of credit costs me a slightly different model rather than the feature.",
    problem:
      "Thirteen routes had been converted and five still built their own Anthropic client, so evaluation and drafting worked while Ask, refining and inbound requests died on the same balance. The wrapper also could not carry a conversation, which is why Ask had stayed on the raw client.",
  },
  {
    subject: "Today and Pipeline load ten times faster",
    area: "Craft",
    title: "The two pages you open most are fast",
    story:
      "As someone opening Today and Pipeline dozens of times a day, I want them to render immediately, so that checking the search costs nothing.",
    problem:
      "Both took about 1.8 seconds against 77 to 224ms for every other page. It was never the database: with 99 applications, every load made a fresh HTTP call to the Proton calendar feed and waited for it, with no cache between requests and no timeout at all, so a slow feed could hold the page open indefinitely. Separately, /releases shipped all 200 commit bodies on every visit at 945 KB.",
  },
  {
    subject: "The calendar stops blocking every page render",
    area: "Craft",
    title: "Pipeline and Today are fast on a cold start too",
    story:
      "As someone opening the app on a phone after hours of not touching it, I want it to be fast on the first load and not just the second, so that the speed does not depend on having just used it.",
    problem:
      "Every render of Today and Pipeline downloaded and parsed the whole ICS feed, about 1.75 seconds, because a subscription URL cannot be asked for a date range. An in-memory cache fixed the warm case and did nothing cold, which on serverless is most loads. The pipeline also could not explain its own order: rows group by status and the sort only orders within a group, so the dropdown described something invisible.",
  },
  {
    subject: "Bring your own model keys",
    area: "Craft",
    title: "Set up your own instance without touching a deployment console",
    story:
      "As someone being handed this app, I want to enter my own model keys in Settings, so that setting it up does not require access to the hosting account or knowing what an environment variable is.",
    problem:
      "An instance could only be configured the way a developer configures things, with vercel env add. That is fine for the person who built it and impossible for anyone else, which made the stand-alone deployment story architectural rather than real: the isolation was genuine but nobody could set one up. Keys are now encrypted at rest, never shown back, and an environment variable still wins so existing deployments are untouched.",
  },
  {
    subject: "A setup page, and instances that know when they are behind",
    area: "Craft",
    title: "Set up from a URL, and get told when an update lands",
    story:
      "As someone handed my own copy of this app, I want a page that shows me what is connected and what each thing turns on, and I want to be told when a newer version exists, so that running my own instance does not mean reading someone else's notes or watching a repository.",
    problem:
      "Setting up meant environment variables and a console, which is fine for the person who built it and impossible for anyone else. And one instance per person, which is what makes the data isolation real, means nobody can push a fix to somebody else's deployment: there was no way for an instance to know it was behind.",
  },
];

/** The story for a shipped commit, if one was written. */
export function storyFor(subject: string): Story | undefined {
  return STORIES.find((s) => s.subject.trim() === subject.trim());
}

/**
 * Every story shipped under one subject.
 *
 * A release is not always one capability. This existed as `storyFor` alone,
 * which quietly meant a commit carrying four user-facing changes could only
 * describe one of them, and the other three were invisible to the person
 * reading the release notes - the exact fault the file header describes,
 * reintroduced one level up.
 */
export function storiesFor(subject: string): Story[] {
  return STORIES.filter((s) => s.subject.trim() === subject.trim());
}
