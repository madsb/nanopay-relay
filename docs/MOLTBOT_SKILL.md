# Building and publishing a Moltbot skill to Clawdhub

This is a developer-focused summary of how Moltbot skills work, how to structure one, and how to publish it to [https://clawdhub.com](https://clawdhub.com).

## What a “skill” is in Moltbot

A Moltbot skill is a directory containing a `SKILL.md` file (plus supporting text files). The skill teaches the agent how to use some tool surface (CLI, script, API wrapper, workflow). ([Moltbot][1])

Skills follow an AgentSkills-compatible `SKILL.md` format, so the same skill folder is often portable to other agents that support the spec. ([Moltbot][2])

## Where Moltbot loads skills from (and why that matters)

Moltbot loads skills from three places, with clear precedence rules: workspace overrides user-managed overrides bundled. ([Moltbot][2])

* Bundled skills (shipped with Moltbot)
* Managed/local skills: `~/.clawdbot/skills`
* Workspace skills: `<workspace>/skills`

Precedence if names conflict: `<workspace>/skills` (highest) → `~/.clawdbot/skills` → bundled (lowest). ([Moltbot][2])

Multi-agent setups: each agent has its own workspace; `~/.clawdbot/skills` is shared across agents on the machine. ([Moltbot][2])

## Skill directory structure

Typical layout:

```
my-skill/
  SKILL.md
  README.md              (optional)
  scripts/
    do-thing.sh
  references/
    api.md               (optional)
```

Clawdhub is optimized for “text-based” skills (instructions + supporting files). Practically: keep everything needed to understand and run the workflow in plain files, and treat anything executable as something you install via a package manager, Homebrew, etc. ([Moltbot][1])

Gotcha seen in the wild: if you publish scripts, make sure they have a real extension (`.sh`, `.py`, etc.) or they may not get packaged/installed as expected. ([Answer Overflow][3])

## `SKILL.md` format (what Moltbot actually parses)

At minimum, your `SKILL.md` must include YAML frontmatter with `name` and `description`. ([Moltbot][2])

Example:

```md
---
name: my-skill
description: Do X quickly using Y
---

# My Skill

## When to use
...

## Steps
...
```

Important parser constraints in Moltbot:

* Frontmatter keys must be single-line.
* `metadata` should be a single-line JSON object (not multiline YAML). ([Moltbot][2])
* Use `{baseDir}` inside instructions when you need to refer to files relative to the skill folder. ([Moltbot][2])

### Optional frontmatter keys Moltbot supports

Moltbot documents several optional keys that affect how the skill is exposed and invoked (especially slash-command behavior): `homepage`, `user-invocable`, `disable-model-invocation`, and command dispatch keys like `command-dispatch`, `command-tool`, `command-arg-mode`. ([Moltbot][2])

## Gating and “requirements” (make skills self-diagnosing)

Moltbot filters skills at load time using `metadata` (single-line JSON) so the agent only sees skills that can actually run on the machine (OS checks, required binaries, required env vars, required config flags). ([Moltbot][2])

Example gating:

```md
---
name: my-skill
description: Use foo to do bar
metadata: {"moltbot":{"requires":{"bins":["foo"],"env":["FOO_API_KEY"],"config":["browser.enabled"]},"primaryEnv":"FOO_API_KEY"}}
---
```

Supported `metadata.moltbot` fields include:

* `os`: `["darwin"|"linux"|"win32"]`
* `requires.bins`, `requires.anyBins`
* `requires.env`
* `requires.config`
* `primaryEnv` (pairs with `skills.entries.<name>.apiKey`)
* `install` (optional installer specs used by the macOS Skills UI) ([Moltbot][2])

Sandbox note: `requires.bins` is checked on the host at skill load time, but if you run sandboxed, the binary must also exist inside the sandbox container (you install it via sandbox setup). ([Moltbot][2])

## Skill configuration, secrets, and env injection

All skills-related config lives under `skills` in `~/.clawdbot/moltbot.json`. ([Moltbot][4])

Key fields:

* `skills.load.extraDirs`: add more directories to scan (lowest precedence)
* `skills.load.watch`: watch skill folders and refresh snapshot
* `skills.install.nodeManager`: npm/pnpm/yarn/bun preference for skill installs
* `skills.entries.<skillName>`: enable/disable per skill, and inject env vars for runs ([Moltbot][4])

Example:

```js
{
  "skills": {
    "load": { "watch": true },
    "entries": {
      "my-skill": {
        "enabled": true,
        "env": { "FOO_API_KEY": "..." }
      }
    }
  }
}
```

Sandboxed sessions do not inherit host `process.env`. If you need env vars in sandboxed execution, set them in the sandbox docker env configuration or bake them into the sandbox image. ([Moltbot][4])

## Local development workflow (fast iteration)

1. Create the skill folder under your workspace: `<workspace>/skills/my-skill/`.
2. Write `SKILL.md` and any helper scripts/docs in the same folder.
3. Start a new Moltbot session (skills are picked up next session; with watch enabled, changes are picked up on the next agent turn). ([Moltbot][1])
4. Test by explicitly invoking it (slash command if user-invocable) and by letting the model choose it via description relevance.

## Publishing to Clawdhub (CLI)

Clawdhub is the public skill registry for Moltbot, and the supported publishing path is the `clawdhub` CLI. ([Moltbot][1])

### Install and login

* Install: `npm i -g clawdhub` (or `pnpm add -g clawdhub`) ([Moltbot][1])
* Auth:

  * `clawdhub login` (browser flow), or
  * `clawdhub login --token <token>` ([Moltbot][1])

### Publish a single skill folder

Publish command + required flags are documented as:

* `clawdhub publish <path> --slug <slug> --name <name> --version <semver> --tags <tags> --changelog <text>` ([Moltbot][1])

Example:

```bash
clawdhub publish ./skills/my-skill \
  --slug my-skill \
  --name "My Skill" \
  --version 1.0.0 \
  --tags latest \
  --changelog "Initial release"
```

### Sync many skills (scan and publish)

If you maintain multiple local skills, `clawdhub sync` scans and publishes new/updated ones:

* `clawdhub sync --all`
* Useful flags: `--dry-run`, `--bump patch|minor|major`, `--tags`, `--changelog`, `--root <dir...>` ([Moltbot][1])

### Versioning model

* Each publish creates a new semver SkillVersion.
* Tags (like `latest`) point to a version and can move for rollback.
* Updates compare content hashes; if local files do not match any published version, the CLI asks before overwriting unless you force it. ([Moltbot][1])

## Testing the published artifact

A clean install test catches packaging mistakes:

1. In an empty temp directory: `clawdhub install <your-slug>`
2. Inspect that all expected files exist under `./skills/<your-slug>/`.
3. Start a new Moltbot session and run a minimal invocation path.
4. Repeat with sandbox enabled if your workflow uses binaries, network, or env vars.

(Install location defaults to `./skills` under current working directory, with fallback to configured Moltbot workspace.) ([Moltbot][1])

## Optional: shipping skills inside a plugin

Plugins can ship skills by listing `skills` directories in `moltbot.plugin.json` (paths relative to plugin root). Plugin skills load when the plugin is enabled and follow the same precedence rules; you can gate them via config requirements. ([Moltbot][2])

## Practical checklist for a good Clawdhub skill

* `description` makes it obvious when the skill should be loaded (so the model selects it correctly).
* Use `metadata.moltbot.requires.*` so the skill disappears when it cannot run.
* Use `{baseDir}` for internal paths.
* Do not embed secrets in `SKILL.md` or scripts; rely on `skills.entries.<name>.env` / sandbox env.
* Keep scripts deterministic and idempotent; prefer “print what you did + where outputs are”.
* Validate that the published package includes everything you reference.
