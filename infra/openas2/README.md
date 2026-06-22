# Local OpenAS2 sandbox

A self-contained pair of OpenAS2 daemons that lets you exercise the hub's AS2
receive channel end-to-end without depending on a partner test environment.

```
  +-----------+      AS2 POST       +--------------+    plaintext EDI    +------------+
  |  sender   | ------------------> |   receiver   | ------------------> |   hub API  |
  | (OpenAS2) |   :10080/as2/HTTP   |  (OpenAS2)   |  drops into shared  |  AS2       |
  |           |                     |              |  folder on host     |  channel   |
  +-----------+ <-- MDN (signed) -- +--------------+                     +------------+
```

Both daemons are profile-gated in `docker-compose.yml` (`profiles: ['as2']`),
so `docker compose up` leaves them alone. Bring them up explicitly:

```bash
docker compose --profile as2 up
```

### Image

`docker-compose.yml` pulls `freightdesk/openas2:latest`. If you'd rather run
Helger's `phax/as2-server`, the volume layout and entrypoint differ — swap
the image and adjust the `config.xml` paths accordingly. The config files
shipped here target the OpenAS2 layout.

---

## One-time setup

OpenAS2 needs a keypair per partner and a partnership XML that maps the
counterpart's certificate to a partner ID. The sandbox ships *skeletons* only
— **certs are not committed**.

### 1. Generate test certificates

```bash
cd infra/openas2

# Receiver keypair (the hub)
mkdir -p receiver/data/certs sender/data/certs
keytool -genkeypair -alias hub \
  -keystore receiver/data/certs/keystore.p12 \
  -storetype PKCS12 -storepass changeit \
  -dname "CN=HUB,O=EDI Data Hub,C=US" \
  -keyalg RSA -keysize 2048 -validity 365

# Sender keypair (the simulated partner)
keytool -genkeypair -alias partner \
  -keystore sender/data/certs/keystore.p12 \
  -storetype PKCS12 -storepass changeit \
  -dname "CN=PARTNER,O=Test Partner,C=US" \
  -keyalg RSA -keysize 2048 -validity 365

# Cross-import the public certs so each side trusts the other.
keytool -exportcert -alias hub     -keystore receiver/data/certs/keystore.p12 -storepass changeit -file /tmp/hub.crt
keytool -exportcert -alias partner -keystore sender/data/certs/keystore.p12   -storepass changeit -file /tmp/partner.crt
keytool -importcert -noprompt -alias partner -keystore receiver/data/certs/keystore.p12 -storepass changeit -file /tmp/partner.crt
keytool -importcert -noprompt -alias hub     -keystore sender/data/certs/keystore.p12   -storepass changeit -file /tmp/hub.crt
```

### 2. Edit partnership XML

`receiver/config/config.xml` and `sender/config/config.xml` are skeletons that
declare the two partner IDs and a single partnership between them. The values
you may need to tweak:

- `<partnership name="partner-to-hub">` — endpoint URL for the sender must
  point at the receiver service on the compose network
  (`http://openas2-receiver:10080/HTTPReceiver`).
- `keystore.p12` paths and storepasses — match what you generated above.

### 3. Bring up the sandbox

```bash
# From the repo root.
docker compose --profile as2 up
```

Then enable the AS2 channel in `.env`:

```env
AS2_ENABLED=true
```

And restart the API.

---

## Sending a test file

The sender daemon exposes its outbox at `infra/openas2/sender/outbox/` — drop
a file there with the receiver partner ID in the filename per the OpenAS2
convention, and the daemon will POST it. The receiver decrypts and writes the
plaintext EDI to `apps/api/.as2/inbox/`, which the hub's AS2 channel picks up
and ingests like any other file.

A successful round-trip produces a signed MDN back to the sender and a new row
in `raw_files` with `source='as2'`.

---

## Why two daemons instead of mocking

The Sprint 2 plan called out OQ 8 as "stand up a local OpenAS2 sandbox" —
that's what this is. A mocked AS2 endpoint can prove the watcher reads files,
but it can't catch:

- Signature/encryption misconfigurations that only surface during the real handshake.
- MDN routing bugs.
- Cert trust issues between the two sides.

Catching those in dev rather than against the pilot's environment is the
point. The mocked variant still exists in `apps/api/test/as2.test.ts` for fast
CI runs.
