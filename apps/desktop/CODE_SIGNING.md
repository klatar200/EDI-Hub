# EDI Hub — Windows code signing

This walkthrough covers the one-time setup required to ship signed
Windows installers, plus the recurring "tag a release" loop.

The signing infrastructure is already wired up. **The cert is the only
thing blocking signed releases** — when it arrives, set two repo
secrets and push a tag.

---

## 1. Cert procurement (one-time, ~1-5 business days)

Buy an **EV (Extended Validation) code-signing certificate** from one
of the major Windows-trusted CAs:

- DigiCert
- Sectigo
- SSL.com
- GlobalSign

Approximate cost: **$300-600/year**, plus a one-time **hardware USB
token** (~$50-100) that the cert ships on. EV certs cannot be issued as
file-based PFX directly — the private key has to live on a FIPS-rated
hardware token.

Why EV (not standard / OV): EV certs **bypass Microsoft SmartScreen
reputation gating immediately**. With a standard cert, the first
hundred-or-so users still see the "Windows protected your PC" warning
until reputation accrues. EV skips that entirely, which matters when
the first customer-facing install needs to be friction-free.

### Procurement checklist

1. Pay the CA invoice.
2. Complete the CA's identity verification (typically a notarized
   business form + phone callback).
3. CA mails the USB token. **Receive at a real address, not a
   PO box** — most CAs require signed-for delivery.
4. Plug in the token, install the CA's token driver (DigiCert calls
   theirs "SafeNet Authentication Client", Sectigo uses similar).
5. Export the signing certificate as a PFX. **The PRIVATE KEY stays on
   the token** — you're exporting only the public cert + binding to the
   token's serial number. The token must be plugged in whenever
   signtool.exe runs.

> ⚠️ **CI signing with a hardware token is hard.** EV certs that
> require a USB token can't sign in GitHub Actions directly — the token
> isn't plugged into the runner. Options:
> - **Cloud-hosted EV cert** (DigiCert KeyLocker, Sectigo Code Signing
>   Service, SSL.com eSigner). The CA hosts the key; signtool talks to
>   it over an API. This is the path that works in CI.
> - **Self-host a Windows signing box** that the runner reaches over a
>   VPN. More moving parts; only worth it at higher volume.
>
> When you order the cert, **ask the CA about cloud-hosted signing
> options up front**. Switching after delivery typically means a
> re-issue.

---

## 2. Repo secrets (once you have the cert)

The release workflow (`.github/workflows/release.yml`) expects these
two secrets:

| Secret | Contents |
| --- | --- |
| `CSC_LINK_B64` | base64-encoded contents of the .pfx (or the cloud-signing JSON config, depending on what your CA provides) |
| `CSC_KEY_PASSWORD` | passphrase for the PFX |

### How to set them

```powershell
# Encode the PFX. -AsByteStream avoids PowerShell's text-mode mangling.
[Convert]::ToBase64String(
  (Get-Content -AsByteStream "C:\path\to\edihub-signing.pfx")
) | Set-Clipboard

# Paste into:
#   GitHub repo → Settings → Secrets and variables → Actions → New repository secret
#   Name: CSC_LINK_B64
#
# Then add a second secret:
#   Name: CSC_KEY_PASSWORD
#   Value: <the passphrase>
```

Until both secrets are present the release workflow runs successfully
but produces an **unsigned** installer and adds a warning to the
Actions summary — that way a forgotten secret never silently ships an
unsigned release.

---

## 3. Local signing (optional — for one-off verification)

To sign a build on your own machine without going through CI:

```powershell
$env:CSC_LINK         = "C:\path\to\edihub-signing.pfx"
$env:CSC_KEY_PASSWORD = "<passphrase>"

npm run dist -w @edi/desktop
```

electron-builder reads both env vars automatically and pipes them to
signtool.exe. When CSC_LINK is empty the build runs unsigned (same as
Sprint 1 dev builds).

If your cert lives on a USB token, plug it in before running and let
the token-driver software handle the signtool handoff. The token will
prompt for its own PIN on the first sign in a session.

---

## 4. Tagging a release

The release workflow triggers on any pushed tag matching `v*`:

```powershell
# Bump the version in apps/desktop/package.json first if appropriate.
git tag v0.0.1-alpha
git push origin v0.0.1-alpha
```

GitHub Actions:

1. Builds @edi/api, @edi/web, @edi/desktop.
2. Restores the PFX from `CSC_LINK_B64` to a temp path on the runner.
3. Runs `npm run dist -w @edi/desktop` with `CSC_LINK` + `CSC_KEY_PASSWORD`
   in the env.
4. Uploads the signed `.exe`, its `.blockmap`, and `latest.yml` to a
   GitHub Release.
5. Wipes the temp PFX.

Tags containing `-alpha`, `-beta`, or `-rc` are marked as prereleases.

---

## 5. Verifying a signed installer

Download the artifact from the Release page on a **clean Windows
machine** (one that has never run this app, ideally a VM snapshot). Then:

```powershell
# 1. Inspect the embedded signature
Get-AuthenticodeSignature .\EDI*x64.exe | Format-List *

# Expect:
#   Status        : Valid
#   StatusMessage : Signature verified.
#   SignerCertificate : <your-EV-cert-subject>

# 2. Double-click the installer. With an EV cert there should be NO
#    SmartScreen "Windows protected your PC" warning — you should go
#    straight to the UAC prompt (per-machine install) or directly to
#    the install wizard (per-user).
```

If you see SmartScreen, the cert isn't being applied (or it's a
standard cert, not EV). Check the Actions log to confirm the signing
step ran.

---

## D6 Sprint 2 scorecard

| Check | Status (until cert arrives) | Status (after cert + tag) |
| --- | --- | --- |
| S13.1 — workflow runs on tag | Verifiable now with a dummy tag; will produce an unsigned artifact | Same workflow, signing step fires |
| S13.2 — installer is signed (no SmartScreen) | Blocked | Verify per § 5 above |

You can dry-run S13.1 right now without the cert: push `v0.0.0-dryrun`
and confirm the workflow completes and uploads an unsigned artifact.
