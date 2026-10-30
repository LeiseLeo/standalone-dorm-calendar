<?php
declare(strict_types=1);

/**
 * Baikal automatic initialization
 *
 * Target: ckulka/baikal:0.10.1-nginx
 *
 * Creates:
 * - Baikal configuration
 * - SQLite database
 * - Admin password
 * - WG CalDAV user
 * - WG user email address
 * - Default WG calendar
 *
 * Existing calendars and passwords are preserved.
 */

$root = '/var/www/baikal';
$configDir = $root . '/config';
$specificDir = $root . '/Specific';

$configFile = $configDir . '/baikal.yaml';
$dbDir = $specificDir . '/db';
$dbFile = $dbDir . '/db.sqlite';
$installDisabled = $specificDir . '/INSTALL_DISABLED';

$adminPassword = getenv('BAIKAL_ADMIN_PASSWORD') ?: '';
$wgUsername = getenv('BAIKAL_WG_USERNAME') ?: '';
$wgPassword = getenv('BAIKAL_WG_PASSWORD') ?: '';
$wgEmail = getenv('BAIKAL_WG_EMAIL') ?: '';

$configuredVersion = getenv('BAIKAL_CONFIGURED_VERSION') ?: '0.10.1';
$timezone = getenv('TZ') ?: 'Europe/Berlin';

$realm = 'BaikalDAV';
$calendarName = 'WG-Kalender';
$calendarUri = 'default';

/**
 * Print an error and terminate initialization.
 */
function fail(string $message): never
{
    fwrite(STDERR, "ERROR: {$message}\n");
    exit(1);
}

/**
 * Ensure a directory exists.
 */
function ensureDirectory(string $path): void
{
    if (!is_dir($path)) {
        if (!mkdir($path, 0775, true) && !is_dir($path)) {
            fail("Could not create directory: {$path}");
        }
    }
}

/**
 * Set ownership and permissions for Baikal.
 */
function fixPermissions(
    string $configDir,
    string $specificDir,
    string $dbDir,
    string $dbFile,
    string $configFile
): void {
    echo "Fixing Baikal permissions...\n";

    foreach ([$configDir, $specificDir, $dbDir] as $directory) {
        if (is_dir($directory)) {
            if (!chown($directory, 'nginx') || !chgrp($directory, 'nginx')) {
                fail("Could not set ownership on {$directory}");
            }

            chmod($directory, 0775);
        }
    }

    foreach ([$configFile, $dbFile] as $file) {
        if (is_file($file)) {
            if (!chown($file, 'nginx') || !chgrp($file, 'nginx')) {
                fail("Could not set ownership on {$file}");
            }

            chmod($file, 0664);
        }
    }
}

/**
 * Validate required environment variables.
 */

if (
    $adminPassword === '' ||
    $wgUsername === '' ||
    $wgPassword === '' ||
    $wgEmail === ''
) {
    fail(
        'BAIKAL_ADMIN_PASSWORD, BAIKAL_WG_USERNAME, ' .
        'BAIKAL_WG_PASSWORD and BAIKAL_WG_EMAIL are required.'
    );
}

if (!preg_match('/^[A-Za-z0-9._-]+$/', $wgUsername)) {
    fail(
        'BAIKAL_WG_USERNAME may only contain letters, numbers, dots, underscores and hyphens.'
    );
}

if (!filter_var($wgEmail, FILTER_VALIDATE_EMAIL)) {
    fail("Invalid WG email address: {$wgEmail}");
}

if (!in_array($timezone, timezone_identifiers_list(), true)) {
    fail("Invalid timezone: {$timezone}");
}

if (!is_dir($root)) {
    fail("Baikal installation directory not found: {$root}");
}

if (!is_dir($configDir) || !is_dir($specificDir)) {
    fail('Baikal configuration or data directory does not exist.');
}

require_once $root . '/vendor/autoload.php';

ensureDirectory($dbDir);

// --------------------------------------------------
// First-time installation
// --------------------------------------------------

$firstInstall = !file_exists($configFile);

if ($firstInstall) {

    if (is_file($dbFile) && filesize($dbFile) > 0) {
        fail(
            'Database exists but configuration is missing. ' .
            'Refusing to overwrite existing data.'
        );
    }

    $schemaFile = $root . '/Core/Resources/Db/SQLite/db.sql';

    if (!is_file($schemaFile)) {
        fail("SQLite schema not found: {$schemaFile}");
    }

    echo "Initializing Baikal configuration...\n";

    $config = [
        'system' => [
            'configured_version' => $configuredVersion,
            'timezone' => $timezone,
            'card_enabled' => true,
            'cal_enabled' => true,
            'invite_from' => '',
            'dav_auth_type' => 'Basic',

            // Baikal admin username is always "admin".
            // Hash format follows BaikalAdmin\Core\Auth.
            'admin_passwordhash' => hash(
                'sha256',
                'admin:' . $realm . ':' . $adminPassword
            ),

            'failed_access_message' =>
                'user %u authentication failure for Baikal',

            'auth_realm' => $realm,
            'base_uri' => '',
        ],

        'database' => [
            'encryption_key' => bin2hex(random_bytes(16)),
            'backend' => 'sqlite',
            'sqlite_file' => $dbFile,
        ],
    ];

    $yaml = Symfony\Component\Yaml\Yaml::dump($config, 4, 2);

    $temporaryConfig = $configFile . '.tmp';

    if (
        file_put_contents($temporaryConfig, $yaml, LOCK_EX) === false
    ) {
        fail('Could not write Baikal configuration.');
    }

    try {
        $schema = file_get_contents($schemaFile);

        if ($schema === false) {
            fail('Could not read SQLite schema.');
        }

        $pdo = new PDO('sqlite:' . $dbFile);
        $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);

        $pdo->exec($schema);

        $pdo = null;

        if (!rename($temporaryConfig, $configFile)) {
            fail('Could not activate Baikal configuration.');
        }

        echo "Baikal configuration and database initialized.\n";

    } catch (Throwable $e) {
        @unlink($temporaryConfig);

        fail(
            'Database initialization failed: ' . $e->getMessage()
        );
    }

} else {

    if (!is_file($dbFile)) {
        fail('Configuration exists but SQLite database is missing.');
    }

    echo "Existing Baikal configuration detected.\n";
    echo "Preserving existing configuration and database.\n";
}

// --------------------------------------------------
// Connect to SQLite
// --------------------------------------------------

try {
    $pdo = new PDO('sqlite:' . $dbFile);

    $pdo->setAttribute(
        PDO::ATTR_ERRMODE,
        PDO::ERRMODE_EXCEPTION
    );

    $pdo->exec('PRAGMA foreign_keys = ON');

} catch (Throwable $e) {
    fail('Could not connect to SQLite: ' . $e->getMessage());
}

// --------------------------------------------------
// Check existing WG account
// --------------------------------------------------

$principalUri = 'principals/' . $wgUsername;

$userQuery = $pdo->prepare(
    'SELECT id FROM users WHERE username = :username'
);

$userQuery->execute([
    ':username' => $wgUsername,
]);

$userExists = $userQuery->fetch(PDO::FETCH_ASSOC);

$principalQuery = $pdo->prepare(
    'SELECT id FROM principals WHERE uri = :uri'
);

$principalQuery->execute([
    ':uri' => $principalUri,
]);

$principalExists = $principalQuery->fetch(PDO::FETCH_ASSOC);

// --------------------------------------------------
// Create WG account if necessary
// --------------------------------------------------

if (!$userExists && !$principalExists) {

    echo "Creating WG user '{$wgUsername}'...\n";

    try {
        $pdo->beginTransaction();

        // Create principal, including email address.
        $principalInsert = $pdo->prepare(
            'INSERT INTO principals
                (uri, email, displayname)
             VALUES
                (:uri, :email, :displayname)'
        );

        $principalInsert->execute([
            ':uri' => $principalUri,
            ':email' => $wgEmail,
            ':displayname' => $wgUsername,
        ]);

        // Create CalDAV authentication account.
        $userInsert = $pdo->prepare(
            'INSERT INTO users (username, digesta1)
             VALUES (:username, :digesta1)'
        );

        $userInsert->execute([
            ':username' => $wgUsername,
            ':digesta1' => md5(
                $wgUsername . ':' . $realm . ':' . $wgPassword
            ),
        ]);

        $pdo->commit();

        echo "WG user created successfully.\n";

    } catch (Throwable $e) {

        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }

        fail('Could not create WG account: ' . $e->getMessage());
    }

} elseif ($userExists && $principalExists) {

    echo "Existing WG user '{$wgUsername}' detected.\n";

    // Update email address without changing the password.
    $emailUpdate = $pdo->prepare(
        'UPDATE principals
         SET email = :email,
             displayname = :displayname
         WHERE uri = :uri'
    );

    $emailUpdate->execute([
        ':email' => $wgEmail,
        ':displayname' => $wgUsername,
        ':uri' => $principalUri,
    ]);

    echo "WG email address updated.\n";

} else {

    fail(
        'Inconsistent account state: user or principal is missing. ' .
        'Manual database inspection is required.'
    );
}

// --------------------------------------------------
// Ensure default WG calendar exists
// --------------------------------------------------

$calendarQuery = $pdo->prepare(
    'SELECT id
     FROM calendarinstances
     WHERE principaluri = :principaluri
       AND uri = :uri'
);

$calendarQuery->execute([
    ':principaluri' => $principalUri,
    ':uri' => $calendarUri,
]);

$calendarExists = $calendarQuery->fetch(PDO::FETCH_ASSOC);

if (!$calendarExists) {

    echo "Creating default WG calendar...\n";

    try {
        $pdo->beginTransaction();

        // Create calendar.
        $calendarInsert = $pdo->prepare(
            'INSERT INTO calendars (synctoken, components)
             VALUES (1, :components)'
        );

        $calendarInsert->execute([
            ':components' => 'VEVENT,VTODO,VJOURNAL',
        ]);

        $calendarId = (int) $pdo->lastInsertId();

        // Assign calendar to WG principal.
        $instanceInsert = $pdo->prepare(
            'INSERT INTO calendarinstances
                (
                    calendarid,
                    principaluri,
                    access,
                    displayname,
                    uri,
                    calendarorder
                )
             VALUES
                (
                    :calendarid,
                    :principaluri,
                    1,
                    :displayname,
                    :uri,
                    1
                )'
        );

        $instanceInsert->execute([
            ':calendarid' => $calendarId,
            ':principaluri' => $principalUri,
            ':displayname' => $calendarName,
            ':uri' => $calendarUri,
        ]);

        $pdo->commit();

        echo "Default WG calendar created successfully.\n";

    } catch (Throwable $e) {

        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }

        fail('Could not create WG calendar: ' . $e->getMessage());
    }

} else {

    echo "Default WG calendar already exists. Preserving it.\n";
}

// --------------------------------------------------
// Disable installation wizard
// --------------------------------------------------

if (!file_exists($installDisabled)) {

    if (
        file_put_contents(
            $installDisabled,
            "Provisioned automatically by Docker.\n",
            LOCK_EX
        ) === false
    ) {
        fail('Could not disable installation wizard.');
    }

    echo "Baikal installation wizard disabled.\n";
}

// --------------------------------------------------
// Finalize permissions
// --------------------------------------------------

$pdo = null;

fixPermissions(
    $configDir,
    $specificDir,
    $dbDir,
    $dbFile,
    $configFile
);

echo "\n";
echo "========================================\n";
echo "Baikal initialization completed.\n";
echo "========================================\n";
echo "WG username: {$wgUsername}\n";
echo "WG email:    {$wgEmail}\n";
echo "Calendar:    {$calendarName}\n";
echo "========================================\n";
