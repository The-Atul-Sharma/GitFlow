import { z } from "zod";
import chalk from "chalk";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

export type ConfirmMode = "interactive" | "auto" | "dryrun";

export type ConfirmAction = "yes" | "no" | "edit" | "regenerate";

export interface ConfirmOptions {
  mode: ConfirmMode;
  preview: string;
  actions?: ConfirmAction[];
}

export type ConfirmResult =
  | { action: "yes" }
  | { action: "no" }
  | { action: "edit"; editedText: string }
  | { action: "regenerate" };

export interface Confirmation {
  ask(options: ConfirmOptions): Promise<ConfirmResult>;
}

export class ConfirmationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfirmationError";
  }
}

const confirmActionSchema = z.enum(["yes", "no", "edit", "regenerate"]);
const confirmModeSchema = z.enum(["interactive", "auto", "dryrun"]);

const confirmOptionsSchema = z.object({
  mode: confirmModeSchema,
  preview: z.string(),
  actions: z.array(confirmActionSchema).min(1).optional(),
});

const ACTION_SHORTCUTS: Record<ConfirmAction, string> = {
  yes: "y",
  no: "n",
  edit: "e",
  regenerate: "r",
};

const ACTION_LABELS: Record<ConfirmAction, string> = {
  yes: "yes",
  no: "cancel",
  edit: "edit",
  regenerate: "regenerate",
};

function formatHints(actions: ConfirmAction[]): string {
  return actions
    .map((a) => `[${ACTION_SHORTCUTS[a]}] ${ACTION_LABELS[a]}`)
    .join("  ");
}

interface EnquirerLike {
  prompt(options: unknown): Promise<Record<string, unknown>>;
}

let enquirerPromise: Promise<EnquirerLike | null> | null = null;

async function loadEnquirer(): Promise<EnquirerLike | null> {
  if (enquirerPromise) return enquirerPromise;
  enquirerPromise = (async () => {
    try {
      const mod = (await import("enquirer")) as
        | EnquirerLike
        | { default: EnquirerLike };
      return "default" in mod && mod.default
        ? mod.default
        : (mod as EnquirerLike);
    } catch {
      return null;
    }
  })();
  return enquirerPromise;
}

async function readlinePrompt(
  actions: ConfirmAction[],
): Promise<ConfirmAction> {
  const readline = await import("node:readline");
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const question = `${chalk.cyan("Choose an action")} ${chalk.dim(formatHints(actions))}: `;
  return new Promise((resolve) => {
    rl.on("close", () => resolve("no"));
    rl.question(question, (answer) => {
      rl.close();
      const trimmed = answer.trim().toLowerCase();
      const match = actions.find(
        (a) => ACTION_SHORTCUTS[a] === trimmed || a === trimmed,
      );
      resolve(match ?? "no");
    });
  });
}

async function openEditor(initialContent: string): Promise<string> {
  const editor = process.env["EDITOR"] ?? "vim";
  const tmpPath = join(
    tmpdir(),
    `gpilot-${randomBytes(8).toString("hex")}.txt`,
  );
  await fs.writeFile(tmpPath, initialContent, "utf8");
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(editor, [tmpPath], { stdio: "inherit" });
      child.on("error", (err) => {
        reject(
          new ConfirmationError(
            `Failed to launch editor "${editor}": ${err.message}. Set the $EDITOR environment variable to a valid editor command, e.g. export EDITOR=nano`,
          ),
        );
      });
      child.on("exit", (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(
            new ConfirmationError(
              `Editor "${editor}" exited with non-zero code ${code}. Set $EDITOR to a working editor command, e.g. export EDITOR=nano`,
            ),
          );
        }
      });
    });
    return await fs.readFile(tmpPath, "utf8");
  } finally {
    await fs.unlink(tmpPath).catch(() => undefined);
  }
}

async function promptForAction(
  actions: ConfirmAction[],
): Promise<ConfirmAction> {
  const enquirer = await loadEnquirer();
  if (!enquirer) {
    return readlinePrompt(actions);
  }
  try {
    const response = await enquirer.prompt({
      type: "select",
      name: "action",
      message: chalk.cyan(
        `Choose an action ${chalk.dim(formatHints(actions))}`,
      ),
      choices: actions.map((a) => ({
        name: a,
        message: `${ACTION_LABELS[a]} (${ACTION_SHORTCUTS[a]})`,
        value: a,
      })),
    });
    const chosen = response["action"];
    if (typeof chosen === "string") {
      const match = actions.find((a) => a === chosen);
      if (match) return match;
    }
    return "no";
  } catch {
    return "no";
  }
}

/**
 * Create a Confirmation prompt helper for CLI flows.
 *
 * Returns a single object whose `ask` method renders a preview and prompts
 * the user according to the configured mode:
 *   - 'interactive': show preview + prompt and wait for user input
 *   - 'auto': skip prompt, always return 'yes' (CI/CD friendly)
 *   - 'dryrun': print preview and return 'no' (preview-only)
 *
 * In interactive mode, the 'edit' action launches $EDITOR (falling back
 * to vim) on a temp file seeded with the preview, and returns the edited
 * content. Cancellation (ESC / Ctrl+C) is treated as 'no' rather than an
 * error. Editor launch failures throw `ConfirmationError`.
 *
 * @returns a Confirmation usable across the app
 */
export function createConfirmation(): Confirmation {
  return {
    async ask(options) {
      const validated = confirmOptionsSchema.parse(options);
      const actions = validated.actions ?? ["yes", "no"];

      if (validated.mode === "auto") {
        return { action: "yes" };
      }

      if (validated.mode === "dryrun") {
        process.stdout.write(`${chalk.white(validated.preview)}\n`);
        return { action: "no" };
      }

      process.stdout.write(`${chalk.white(validated.preview)}\n`);

      const chosen = await promptForAction(actions);

      if (chosen === "edit") {
        const editedText = await openEditor(validated.preview);
        return { action: "edit", editedText };
      }

      if (chosen === "yes" || chosen === "regenerate") {
        return { action: chosen };
      }

      return { action: "no" };
    },
  };
}
