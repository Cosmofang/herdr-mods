# herdr-mods

These are mods for the [Herdr](https://github.com/herdrdev/herdr-app) desktop app. They are inspired by the task board in T3 Code.

Each feature is a separate mod placed in `~/.config/herdr-app/mods/`. **Herdr itself is not modified or forked**, so it keeps updating itself as usual. Herdr only replaces the mods it ships with when it starts; mods you add yourself are left alone.

## Mods

| Mod | Status | What it does |
|---|---|---|
| `board` | Usable | Task board with columns: To do, Doing, Review, Done. Cards move with agent status. You can hand a card to an AI. |
| `side-tasks` | Planned | Turn side tasks an agent proposes into cards. |
| `tok-meter` | Planned | Show tok/s and token usage live. |

### board

- **Open it**: press ⌘⇧P and choose `Board: 打开看板` ("Open board"). It opens as a new tab.
- **Cards**: type in the input at the top of the To do column and press Enter. Click a card to edit its title, Markdown details, due date and working directory. You can also pin, archive or delete it from there.
- **Moves with agents**: once a card is linked to an agent, the card moves when the agent's status changes. Working → Doing; waiting for you or finished → Review. A column you drag the card to stays put until the agent's status changes again. Turn this off with the "随 agent 自动移动" ("Move with agent") switch in the top right.
- **Drag agents onto the board**: agents not yet on the board are listed at the top. Drag one onto a column to create a card linked to it. If it already has a card, that card moves to the column.
- **Hand to AI**: in a card's details, click "交给 AI" ("Hand to AI"). This opens a new tab in the card's working directory and starts your most-used installed agent. The card's title and details are its first message. The card links itself to the new agent.
- **Storage**: data is kept in Herdr's shared state and mirrored to `~/.config/herdr-app/data/herdr-board/board.json`.

## Install

```sh
git clone https://github.com/Cosmofang/herdr-mods.git ~/code/herdr-mods
~/code/herdr-mods/install.sh
```

`install.sh` symlinks each mod in `mods/` into `~/.config/herdr-app/mods/` and runs `herdr-app check` on it. If a folder with the same name already exists and isn't a symlink, it is skipped.

To update, run `git pull`. Herdr reloads a mod as soon as its files change.

## Compatibility

- These mods use only the public API in `~/.config/herdr-app/herdr.d.ts`. They were developed against Herdr.app 0.1.18.
- After Herdr updates, run `./install.sh` (or `herdr-app check ~/.config/herdr-app/mods/board`) to confirm nothing broke.

## Development

```sh
./tests/run.sh                                  # pure-logic tests (Node)
herdr-app check ~/.config/herdr-app/mods/board  # load and render once in Herdr
herdr-app status                                # runtime errors
```

The mod API guide is `~/.config/herdr-app/AGENTS.md`.

## License

Apache-2.0, the same as Herdr.
