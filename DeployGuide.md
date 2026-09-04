# Deploy Guide

How to change code and get it live on moreleadnow.com. Local repo:
`/Users/tuandang/personal/research/AI/bbb-trading-ext`. Droplet:
`root@138.197.77.18` (DigitalOcean, `bbb-trading-ext`).

## One-time setup: SSH key access to the droplet

`deploy/deploy.sh` needs to SSH into the droplet from your Mac. Do this
once, the first time you use it (or on a new machine).

1. **Check if you already have an SSH key** (Terminal.app):
   ```
   ls -la ~/.ssh/
   ```
   Look for a matching pair like `id_ed25519` + `id_ed25519.pub`, or
   `id_rsa` + `id_rsa.pub`. The `.pub` file is the public key (safe to
   share); the one without `.pub` is private -- never share that one.
   If you see a pair, skip to step 3.

2. **Generate a new key** (only if step 1 found nothing):
   ```
   ssh-keygen -t ed25519 -C "tuan-do-deploy"
   ```
   Press Enter through all the prompts -- default file location, empty
   passphrase is simplest for a script that runs unattended.

3. **Copy your public key to the clipboard**:
   ```
   cat ~/.ssh/id_ed25519.pub | pbcopy
   ```
   (Use whatever filename matched in step 1 if it wasn't
   `id_ed25519.pub`.)

4. **Add that key to the droplet**:
   - Go to [cloud.digitalocean.com](https://cloud.digitalocean.com) and
     log in.
   - Click **Droplets**, then click the `bbb-trading-ext` droplet.
   - Click **Access** in the droplet's tab list, then
     **Launch Droplet Console** -- a browser terminal opens, already
     logged in as root.
   - In that console, run:
     ```
     mkdir -p /root/.ssh && chmod 700 /root/.ssh
     echo "PASTE_YOUR_KEY_HERE" >> /root/.ssh/authorized_keys
     chmod 600 /root/.ssh/authorized_keys
     ```
     Replace `PASTE_YOUR_KEY_HERE` by pasting your clipboard (Cmd+V) in
     place of that text -- it should land as one single unbroken line
     starting with `ssh-ed25519 AAAA...`.
   - Confirm it saved correctly:
     ```
     cat /root/.ssh/authorized_keys
     ```
     Your key should appear as its own unbroken line, alongside the
     existing DigitalOcean-managed key that's already there.

5. **Test the connection** (back in Terminal.app on your Mac):
   ```
   ssh root@138.197.77.18
   ```
   This should log you straight in with no password prompt. Type `exit`
   to leave. If it still asks for a password, the key line probably got
   wrapped or cut off when pasting in step 4 -- go back and check
   `cat /root/.ssh/authorized_keys`.

## Every time you change code

1. **Sync first**
   ```
   cd /Users/tuandang/personal/research/AI/bbb-trading-ext
   git pull
   ```

2. **Make your change**
   Edit the code yourself, or ask Claude to.

3. **Commit and push**
   ```
   git add -A
   git commit -m "describe your change"
   git push
   ```

4. **Deploy**
   ```
   deploy/deploy.sh
   ```
   This refuses to run if your working tree is dirty or unpushed, then
   SSHes into the droplet, pulls `origin/main`, rebuilds the
   `trading-console` dashboard, recreates the `dist/data` symlink that
   `npm run build` deletes every time, restarts `ext-server` and
   `market-server`, and reloads Caddy.

5. **Verify**
   Check [moreleadnow.com](https://moreleadnow.com) to confirm the
   change is live.

Steps 1, 3, and 4 are the same three commands every time -- only step 2
(and eyeballing the result in step 5) varies with what actually changed.

## Troubleshooting

- **`deploy/deploy.sh` says you have uncommitted changes** -- commit or
  stash them first; the script won't deploy a dirty tree.
- **It says local `main` differs from `origin/main`** -- you forgot to
  `git push`. Push, then re-run the script.
- **`ssh root@138.197.77.18` asks for a password** -- your public key
  isn't in `/root/.ssh/authorized_keys` correctly. Repeat the one-time
  setup above, steps 3-5.
- **You need to target a different host** (e.g. a staging droplet):
  ```
  DROPLET_HOST=user@1.2.3.4 deploy/deploy.sh
  ```
