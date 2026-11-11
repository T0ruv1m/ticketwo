# Hosting Tickets on the LAN

## Dedicated Linux server

Place the `tickets2` and `nfe-lookup2` repositories next to each other and
configure the NF-e API's ignored `../nfe-lookup2/.env` with its Google Drive
credentials. Install Docker Engine and Compose, then from the Tickets
repository run:

```bash
docker compose up -d --build
docker compose ps
curl -fsS http://127.0.0.1:8787/api/health
```

Open `http://<Linux-server-LAN-IP>:8787` on another device. Permit TCP 8787 through
the Linux host firewall for your LAN. Compose builds and starts the sibling NF-e
API without publishing its port. Tickets reaches it at `http://api:8000` on
the private Compose network. The audit file is retained on the
host at `var/prints.jsonl`; back up this directory. The queue and generated
PDFs are still in memory and are lost when the container restarts.

Docker publishes the port on all host addresses by default here. To bind only
one address, set `TICKETS_BIND_ADDRESS` to the server's LAN IP. Set
`TICKETS_HOST_PORT` if 8787 is already occupied.

## Current Windows + WSL host

This host previously had Windows port proxies for both `192.168.3.127:8787`
and `192.168.3.127:18787`, each targeting WSL port 8787. Starting Tickets on
8787 returned `EADDRINUSE` even though the WSL listener check was empty.
Tickets started and answered `/api/health` on WSL port 18788. The Windows
firewall rule `tickets-windows-lan-18787` already existed; attempting to create
it again returned “Cannot create a file when that file already exists.”

For the Node server in WSL, start it with:

```bash
PORT=18788 npm start
curl -fsS http://127.0.0.1:18788/api/health
```

For Docker in WSL, this checkout's ignored `.env` publishes the container on
`127.0.0.1:18789`, because a separate Node Tickets server already occupies
18788. Use:

```bash
docker compose up -d --build
curl -fsS http://127.0.0.1:18789/api/health
```

In an **Administrator PowerShell**, point the existing Windows LAN listener
at the working WSL backend:

```powershell
netsh interface portproxy delete v4tov4 listenaddress=192.168.3.127 listenport=18787
netsh interface portproxy add v4tov4 listenaddress=192.168.3.127 listenport=18787 connectaddress=127.0.0.1 connectport=18789
netsh interface portproxy show v4tov4
```

Then check `http://192.168.3.127:18787/api/health` on Windows and on a second
LAN device. If Windows can reach it but the other device cannot, inspect the
existing Windows firewall rule for TCP 18787 and the Ethernet network profile.
If the Windows LAN IP changes, update the listener address and firewall rule.
The last attempted port-proxy update from a non-administrator shell failed, so
the current Windows rule must be checked before assuming it points to 18789.

This WSL-specific forwarding is not part of a native Linux deployment. On a
dedicated Linux server, the remaining networking checks are Docker's published
port, the host firewall, and whether the LAN can route to that server.
