# Deploying to the LXC host

VoidRecll is hosted on a dedicated Proxmox LXC container on the LAN.

| | |
|---|---|
| URL | **http://192.168.100.198/** |
| Hostname | `VoidRecll` |
| IP | `192.168.100.198` |
| App slot | `voidrecll` (port 8080, behind nginx on port 80) |
| Service | `webapp@voidrecll.service` |
| SSH | `ssh -i ~/Desktop/TheVoidCo/ops/keys/thevoidco-lxc-id_ed25519 root@192.168.100.198` |

The operational reference for the box is `~/Desktop/Local-LXC-Host.md`. This
project follows that model: one app slot, one nginx server block, one systemd
instance from the `webapp@.service` template.

## Deploying a change

```bash
./deploy/deploy-lxc.sh
```

That builds the site, ships it to the box, and hands it to `appctl`, which
rsyncs it into the slot and restarts the service. The equivalent by hand:

```bash
npm run build
tar -C dist -czf - . | ssh -i <key> root@192.168.100.198 'tar -xzf - -C /root/staging/voidrecll'
ssh -i <key> root@192.168.100.198 'appctl deploy voidrecll /root/staging/voidrecll'
```

## Checking on it

```bash
ssh -i <key> root@192.168.100.198 'appctl status voidrecll'
ssh -i <key> root@192.168.100.198 'appctl logs voidrecll'
ssh -i <key> root@192.168.100.198 'journalctl -u webapp@voidrecll -f'
```

nginx logs for the app are in `/var/log/webapps/voidrecll/`.

## Gotchas

- **The word sets live in `content/`, not `data/`.** On this host `data/` means
  an app's writable state, and `appctl deploy` excludes it — a `data/` folder
  in the source tree would be silently dropped on every deploy, leaving the
  site with no word sets and no obvious error. `content/` avoids the clash.
- **`appctl create` rewrites the nginx block**, which drops the two additions
  made here. If the slot is ever re-created, re-apply them:
  - `server_name voidrecll.local 192.168.100.198;` — without the IP the app
    only answers to the `.local` name, and `http://192.168.100.198/` falls
    through to the base landing page.
  - `gzip_types ...` — nginx gzips only `text/html` by default, and the app
    ships a 52 KB `js/app.js`.
- **The service worker does not register over plain http.** It needs a secure
  origin, so on the LAN URL the app runs without offline support and without
  the install prompt. That is handled in the app, not an error — but it means
  the deployed site is not a PWA until it has https.

## Why there is a Node process at all

The app is a pure static site: no server-side logic, no database, all progress
lives in the browser's localStorage. `deploy/server.js` exists only because
the host runs every app as a Node process behind nginx, bound to `127.0.0.1`.

It could be dropped — nginx can serve the files directly with a `root`
directive. Measured on the same box, serving the same 50,000 requests:

| | Node + nginx | nginx direct |
|---|---|---|
| Requests/sec | 4,312 | 6,585 |
| CPU per request | 0.26 ms | 0.12 ms |
| App memory (idle) | 126 MB | 0 (no process) |

The house model was kept for consistency with the rest of the box, and because
it keeps `appctl status`, `appctl logs` and the landing page working as
documented.
