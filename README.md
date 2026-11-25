# herdr-mods

These are mods for the [Herdr](https://github.com/herdrdev/herdr-app) desktop app. They are inspired by the task board in T3 Code.

Each feature is a separate mod placed in `~/.config/herdr-app/mods/`. **Herdr itself is not modified or forked**, so it keeps updating itself as usual. Herdr only replaces the mods it ships with when it starts; mods you add yourself are left alone.

## Mods

| Mod | Status | What it does |
|---|---|---|
| `board` | Usable | Task board with columns: To do, Doing, Review, Done. Cards move with agent status. You can hand a card to an AI. |
| `side-tasks` | Usable | Agents suggest side tasks with `herdr-suggest-task`; put each on the board, start it in a new tab, hand it back, or dismiss it. |
| `tok-meter` | Usable | Live tok/s, context fill and token totals per agent (Claude Code and Codex), also shown on board cards. |

### board

- **Open it**: press ⌘⇧P and choose `Board: 打开看板` ("Open board"). It opens as a new tab.
- **Cards**: type in the input at the top of the To do column and press Enter. Click a card to edit its title, Markdown details, due date and working directory. You can also pin, archive or delete it from there.
- **Moves with agents**: once a card is linked to an agent, the card moves when the agent's status changes. Working → Doing; waiting for you or finished → Review. A column you drag the card to stays put until the agent's status changes again. Turn this off with the "随 agent 自动移动" ("Move with agent") switch in the top right.
- **Drag agents onto the board**: agents not yet on the board are listed at the top. Drag one onto a column to create a card linked to it. If it already has a card, that card moves to the column.
- **Hand to AI**: in a card's details, click "交给 AI" ("Hand to AI"). This opens a new tab in the card's working directory and starts your most-used installed agent. The card's title and details are its first message. The card links itself to the new agent.
- **Storage**: data is kept in Herdr's shared state and mirrored to `~/.config/herdr-app/data/herdr-board/board.json`.

### side-tasks

Like T3's `suggest_task`: an agent that notices work outside its current task (a bug, a cleanup, a follow-up) offers it instead of doing it or forgetting it.

- **Open it**: ⌘⇧P → `Side tasks: 在右侧打开` ("Open on the right"). New suggestions also pop a notification.
- **Agents suggest** with the command `install.sh` puts in `~/.local/bin`:
  ```sh
  herdr-suggest-task --title "Fix flaky login test" \
    --prompt "What, where, why and how to check it, for an agent that hasn't seen this thread." \
    --reason "Why it matters, in a sentence."
  ```
  It drops a JSON file into `~/.config/herdr-app/data/herdr-side-tasks/inbox/`, recording the folder and the Herdr terminal (`HC_TERMINAL_ID`) it came from.
- **For each suggestion**: 放上看板 (put it on the board as a To do card), 新标签去做 (start it in a new tab with your most-used agent), 交还给它 (paste it back into the agent that found it, via `hc send`), or 忽略 (dismiss).
- **Teach your agents**: add this to `~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md` or a project's agent instructions:
  ```md
  ## Side tasks (Herdr)
  When you notice work worth doing outside your current task (a bug, cleanup or follow-up),
  don't do it and don't just mention it: offer it with
  `herdr-suggest-task --title "…" --prompt "…" [--reason "…"]`.
  One task per call. The prompt must stand alone for an agent that hasn't seen this
  conversation: what, where, why, and how to check it. Not for steps of your current task.
  ```

### tok-meter

- **Open it**: ⌘⇧P → `Tok meter: 在右侧打开` ("Open on the right") or `在新标签打开` ("Open in a new tab").
- **Per agent**: output speed of the last timed request (tok/s, T3's rule: at least 20 tokens over at least 0.5 s), context used against the model's window, and output / cache-read / new-input totals for the session.
- **Where it reads**: Herdr has no token API, so it reads the agents' own transcripts: Claude Code's `~/.claude/projects/<folder>/*.jsonl` and Codex's `~/.codex/sessions/**/rollout-*.jsonl`, matched to each agent by its working directory. Several agents in one folder take that folder's newest transcripts, most recently active first, so the match can be wrong there.
- **On the board**: while tok-meter is open, linked cards show the speed (`Claude Code · 运行中 · 60 tok/s`).

## Install

```sh
git clone https://github.com/Cosmofang/herdr-mods.git ~/code/herdr-mods
~/code/herdr-mods/install.sh
```

`install.sh` symlinks each mod in `mods/` into `~/.config/herdr-app/mods/` and runs `herdr-app check` on it. If a folder with the same name already exists and isn't a symlink, it is skipped. It also links `herdr-suggest-task` into `~/.local/bin` (set `HERDR_MODS_BIN` for another folder); make sure that folder is on your `PATH`.

To update, run `git pull`. Herdr reloads a mod as soon as its files change.

## Compatibility

- These mods use only the public API in `~/.config/herdr-app/herdr.d.ts`. They were developed against Herdr.app 0.1.18.
- After Herdr updates, run `./install.sh` (or `herdr-app check ~/.config/herdr-app/mods/board`) to confirm nothing broke.

## Development

```sh
./tests/run.sh                                  # pure-logic tests (Node)
herdr-app check ~/.config/herdr-app/mods/board  # load and render once in Herdr (each mod)
herdr-app status                                # runtime errors
```

The mod API guide is `~/.config/herdr-app/AGENTS.md`. Mods can't import each other's files, so mods talk through shared state: `herdr-board.v1` (the board), `herdr-side-tasks.v1`, and `tok-meter.v1` (speeds by terminal address).

## License

Apache-2.0, the same as Herdr.
