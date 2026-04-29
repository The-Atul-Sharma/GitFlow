# Module: confirmation

## Purpose

Provide interactive y/n/edit/regenerate prompts for the CLI so every
gpilot action has consistent UX. Also supports auto and dryrun modes
where prompts are skipped.

## Public API

```ts
export type ConfirmMode = "interactive" | "auto" | "dryrun";

export interface ConfirmOptions {
  mode: ConfirmMode;
  preview: string; // text shown to the user before the prompt
  actions?: ConfirmAction[]; // which buttons to show, default: yes/no
}

export type ConfirmAction = "yes" | "no" | "edit" | "regenerate";

export type ConfirmResult =
  | { action: "yes" }
  | { action: "no" }
  | { action: "edit"; editedText: string }
  | { action: "regenerate" };

export interface Confirmation {
  ask(options: ConfirmOptions): Promise<ConfirmResult>;
}

export function createConfirmation(): Confirmation;
```

## Behavior by mode

### interactive

- Show preview text to the user
- Show prompt with available actions
- Wait for keyboard input
- For 'edit' action, open the user's $EDITOR with preview as initial content
- Return user's choice

### auto

- Skip prompt entirely
- Always return { action: 'yes' }
- Useful for CI/CD pipelines

### dryrun

- Print preview to stdout
- Return { action: 'no' } so the action does not execute
- Useful for previewing what gpilot would do

## UI requirements

- Use enquirer for the prompt UI
- Use chalk for colored output:
  - preview text: white
  - prompt label: cyan
  - keyboard hints in dim gray
- Format keyboard hints as: [y] yes [e] edit [r] regenerate [n] cancel
- Show only actions listed in options.actions

## Rules

- Default actions if not specified: ['yes', 'no']
- 'edit' action requires $EDITOR env var, fall back to vim if unset
- After 'edit' completes, return the edited text in editedText field
- ESC or Ctrl+C from interactive mode returns { action: 'no' }
- Never throw on user cancellation — treat as 'no'

## Error cases

- $EDITOR fails to launch → throw ConfirmationError with helpful message
  pointing user to set $EDITOR
- enquirer not available → fall back to readline (basic prompt)

## Tests required

- interactive mode shows prompt and returns user choice
- auto mode returns yes without prompting
- dryrun mode returns no without prompting and prints preview
- edit action opens editor and returns edited text
- ESC returns no in interactive mode
- Default actions are yes and no when not specified
- Custom actions are shown when specified
- Mock enquirer in all tests, never prompt for real
