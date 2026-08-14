/**
 * One place that decides what a button looks like.
 *
 * An audit of all 122 buttons found the primary fill written ten different
 * ways - `bg-accent px-3 py-1.5 text-xs` eleven times, `text-sm` eight,
 * `text-[12px]` four, and seven more shapes used once or twice each. Nothing
 * was broken by it; every one of them worked. But there was no answer to "how
 * big is a primary button", so each new one was measured by eye against
 * whatever happened to be nearby, and they drifted apart.
 *
 * This is class strings rather than a `<Button>` component on purpose. These
 * buttons live in server components, client components, `SubmitButton`,
 * `ConfirmButton` and `<Link>`, and a component would have to be threaded
 * through all five. A function returning a class string drops into every one
 * of them without changing any structure.
 *
 * Colours come from Tailwind tokens, never `bg-[var(--accent)]` - that form
 * resolves to nothing at runtime and leaves a correctly-sized invisible
 * button, which has shipped here twice.
 */

export type ButtonVariant = "primary" | "danger" | "outline" | "quiet";
export type ButtonSize = "sm" | "md";

const SIZES: Record<ButtonSize, string> = {
  /** Inline with body text: row actions, chips, anything in a dense list. */
  sm: "rounded-md px-2.5 py-1 text-xs",
  /** The action a page or a panel is actually for. */
  md: "rounded-lg px-3.5 py-2 text-[13px]",
};

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-accent font-medium text-white hover:bg-accent-dark",
  danger: "bg-red-600 font-medium text-white hover:bg-red-700",
  outline: "border border-line text-[var(--tx-2)] hover:bg-[var(--surface-2)] hover:text-[var(--tx)]",
  // No box at all. For the third and fourth thing in a row, where a border
  // would give it the same weight as the action it sits beside.
  quiet: "text-[var(--tx-3)] hover:text-[var(--tx)] hover:underline",
};

export function buttonClass(
  variant: ButtonVariant = "primary",
  size: ButtonSize = "sm",
  extra?: string
): string {
  const base =
    variant === "quiet"
      ? `${SIZES[size].replace(/rounded-\S+ |px-\S+ |py-\S+ /g, "")} transition-colors disabled:opacity-40`
      : `${SIZES[size]} transition-colors disabled:opacity-40`;
  return [base, VARIANTS[variant], extra].filter(Boolean).join(" ");
}

/**
 * One text field, instead of seventeen.
 *
 * A sweep of every `<input>` found seventeen distinct stylings of the same
 * control: `px-2 py-1`, `px-2 py-1.5`, `p-2`, some with `mt-1`, some with a
 * surface background, some bordered `line` and some `line-2`. Nothing was
 * broken by it and no single form looked wrong, which is why it lasted - the
 * same shape as the eleven primary buttons and the four page titles before
 * them.
 *
 * `size` matches the button scale so a field and the button beside it line up,
 * which they frequently did not.
 */
export function inputClass(size: ButtonSize = "md", extra = ""): string {
  const sizes: Record<ButtonSize, string> = {
    sm: "rounded-lg px-2.5 py-1.5 text-xs",
    md: "rounded-lg px-3 py-2 text-[13px]",
  };
  return [
    "w-full border border-line bg-[var(--surface-2)] text-[var(--tx)]",
    "placeholder:text-[var(--tx-3)] disabled:opacity-50",
    sizes[size],
    extra,
  ]
    .filter(Boolean)
    .join(" ");
}
