#!/bin/sh
set -eu

echo "Starting Baikal initialization..."

php /usr/local/bin/init-baikal.php

echo "Fixing SQLite database permissions..."

chown -R nginx:nginx /var/www/baikal/Specific/db
chmod 775 /var/www/baikal/Specific/db

if [ -f /var/www/baikal/Specific/db/db.sqlite ]; then
    chmod 664 /var/www/baikal/Specific/db/db.sqlite
fi

echo "Baikal initialization completed."