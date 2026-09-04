# Deploying bbb-trading-ext

Target: DigitalOcean droplet, Ubuntu 24.04, 1GB RAM, moreleadnow.com.

## 1. Server prep (one time)
```
adduser deploy && usermod -aG sudo deploy
mkdir -p /var/log/bbb-trading-ext && chown deploy:deploy /var/log/bbb-trading-ext
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw --force enable
curl -fsSL https://deb.nodesource.com/setup_lts.x | bash -
apt-get install -y nodejs
apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
apt-get update && apt-get install -y caddy
```

## 2. Get the code
```
su - deploy
git clone git@github.com:<you>/bbb-trading-ext.git /opt/bbb-trading-ext   # or https:// URL
```

## 3. Secrets (copied by hand, never via git)
From your Mac:
```
scp ext-server/.env deploy@<droplet-ip>:/opt/bbb-trading-ext/ext-server/.env
scp market-server/.env deploy@<droplet-ip>:/opt/bbb-trading-ext/market-server/.env
```

## 4. Build the dashboard
```
cd /opt/bbb-trading-ext/trading-console
npm install
npm run build
```

## 5. Install services
```
sudo cp /opt/bbb-trading-ext/deploy/ext-server.service /etc/systemd/system/
sudo cp /opt/bbb-trading-ext/deploy/market-server.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now ext-server market-server
```

## 6. Caddy (reverse proxy + HTTPS + Basic Auth)
```
caddy hash-password   # paste result into deploy/Caddyfile's REPLACE_WITH_BCRYPT_HASH
sudo cp /opt/bbb-trading-ext/deploy/Caddyfile /etc/caddy/Caddyfile
sudo systemctl reload caddy
```
Caddy auto-provisions the Let's Encrypt cert on first request once DNS for
moreleadnow.com points at this droplet's IP.

## 7. Verify
```
systemctl status ext-server market-server caddy
curl -u tuan:<password> https://moreleadnow.com/api/ext/status
```

## Redeploying after code changes
Preferred: run `deploy/deploy.sh` from your local machine (see "Local
deploy access" below for one-time setup). It refuses to run unless your
local `main` is committed and pushed, then SSHes in and does the steps
below for you -- including recreating the `trading-console/dist/data`
symlink that `npm run build` deletes every time (Vite's `emptyOutDir`),
which is easy to forget doing by hand.

Manual equivalent, if you're on the droplet directly:
```
cd /opt/bbb-trading-ext && git pull --ff-only origin main
cd trading-console && npm install && npm run build
rm -rf dist/data && ln -s ../public/data dist/data
cd ..
sudo systemctl restart ext-server market-server
sudo systemctl reload caddy
```

## Local deploy access (one-time setup)
`deploy/deploy.sh` needs SSH key access to the droplet as
`root@138.197.77.18` (override with `DROPLET_HOST=user@host`). To set
this up from a new machine:

```
# On your local machine, if you don't already have a key:
ssh-keygen -t ed25519 -C "<you>-do-deploy"

# Print the public key and add it to the droplet's /root/.ssh/authorized_keys
# (via the DigitalOcean web console, or an existing authorized session):
cat ~/.ssh/id_ed25519.pub
```

Once your public key is in `/root/.ssh/authorized_keys` on the droplet,
`ssh root@138.197.77.18` should work with no password prompt, and
`deploy/deploy.sh` will work too.
