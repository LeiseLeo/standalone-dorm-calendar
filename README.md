# WG-Kalender

Responsive Hugo-Frontend mit Baïkal als CalDAV-Server. Das Frontend kommuniziert direkt aus dem Browser mit Baïkal; es gibt kein eigenes API-Backend.

Die Website ist auf Deutsch und Englisch verfügbar. Die Sprache kann über den Header gewechselt werden. Der Dark Mode wird ebenfalls über den Header aktiviert und im Browser gespeichert; ohne gespeicherte Auswahl folgt er der Systemeinstellung.

## Schnellstart

1. `.env.example` nach `.env` kopieren.
2. `BAIKAL_ADMIN_PASSWORD` und `BAIKAL_WG_PASSWORD` in `.env` durch eigene starke Passwörter ersetzen.
   Für ein Deployment `SITE_URL` auf die öffentliche URL der Anwendung setzen, zum Beispiel `https://kalender.example.de/`.
3. Starten:

   ```bash
   docker compose up --build -d
   ```

4. Öffnen:
   - WG-Frontend: die in `SITE_URL` konfigurierte URL
   - Baïkal-Administration: `<SITE_URL>/admin/`
   - CalDAV-Endpunkt: `<SITE_URL>/dav.php/`

Es ist kein manueller Baïkal-Installationsassistent mehr erforderlich.

## Konten

- Baïkal-Admin: Benutzername ist fest `admin`; Passwort kommt aus `BAIKAL_ADMIN_PASSWORD`.
- WG-CalDAV-Konto: Benutzername und Passwort kommen aus `BAIKAL_WG_USERNAME` und `BAIKAL_WG_PASSWORD`.
- Der WG-Benutzer erhält automatisch einen Kalender mit URI `default`.
- Baïkal wird beim ersten Start auf HTTP Basic Authentication konfiguriert.

Wichtig: Beim ersten Start mit diesem Provisioner werden die Admin-Zugangsdaten aus `.env` einmalig angewendet und die DAV-Authentifizierung auf Basic gesetzt. Auch bei bereits vorhandenen Volumes wird diese einmalige Migration ausgeführt. Der WG-Benutzer wird angelegt, falls er fehlt; existiert er bereits, wird sein Passwort beim ersten Provisionierungslauf einmalig auf den `.env`-Wert gesetzt. Danach verhindert eine Markerdatei weitere Passwortänderungen bei Container-Neustarts. Spätere Passwortänderungen müssen über Baïkal bzw. durch eine bewusst geplante erneute Provisionierung erfolgen.

## Persistenz

Zwei benannte Docker-Volumes speichern sämtliche veränderlichen Baïkal-Daten:

- `baikal-config`: `baikal.yaml` mit Admin-Hash und Datenbankkonfiguration.
- `baikal-data`: SQLite-Datenbank, Benutzer, Kalender und Ereignisse.

`docker compose down` entfernt nur Container und Netzwerk, nicht die Volumes. **`docker compose down -v` löscht auch die Daten.** Regelmäßige Backups beider Volumes sind erforderlich.

## Initialisierung

Das Image `wg-calendar-baikal:local` basiert auf `ckulka/baikal:0.10.1-nginx`. Das Skript `baikal/init-baikal.sh` wird beim Containerstart als `/docker-entrypoint.d/50-init-baikal.sh` ausgeführt.

Bei der ersten Installation:
- erzeugt es `config/baikal.yaml` mit Baïkals SHA-256 Admin-Passworthash,
- erstellt die SQLite-Datenbank mit dem offiziellen Baïkal-Schema,
- setzt `dav_auth_type: Basic`,
- legt den CalDAV-Benutzer samt Principal und Standardkalender an,
- erstellt `Specific/INSTALL_DISABLED`, damit der Installationsassistent nicht erneut erscheint.

Wenn bereits eine Konfiguration existiert, bleibt die Datenbank erhalten. Beim ersten Lauf des neuen Provisioners werden lediglich Admin-Passworthash und `dav_auth_type` einmalig aus `.env` gesetzt. Bestehende Kalender bleiben erhalten; ein `default`-Kalender wird nur angelegt, wenn er für den konfigurierten WG-Benutzer fehlt. Nachfolgende Containerstarts verändern bestehende Passwörter nicht.

## Sicherheit

- Basic Authentication überträgt Zugangsdaten nur dann sicher, wenn HTTPS verwendet wird. Die lokale HTTP-Konfiguration ist ausschließlich für Tests auf demselben Rechner gedacht.
- Vor öffentlicher Bereitstellung HTTPS aktivieren.
- `.env` enthält Klartext-Passwörter und darf nicht in Git eingecheckt werden.
- Baïkal-Admin-Benutzername ist fest `admin`; Baïkal bietet hierfür keine frei konfigurierbare Admin-Username-Variable.
- Der Button „Dashboard teilen“ erzeugt einen Einladungslink mit den Zugangsdaten im URL-Fragment. Das Fragment wird nicht an den Server übertragen und nach der automatischen Anmeldung aus der sichtbaren URL entfernt. Teile solche Links nur mit vertrauenswürdigen Personen und verwende HTTPS.

## Nützliche Befehle

```bash
docker compose logs -f baikal
docker compose logs -f web
docker compose down
docker compose up --build -d
```

Zum vollständigen Zurücksetzen (ACHTUNG: löscht Kalender und Konten):

```bash
docker compose down -v
```
