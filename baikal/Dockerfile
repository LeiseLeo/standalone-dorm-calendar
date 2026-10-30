FROM ckulka/baikal:0.10.1-nginx

COPY init-baikal.sh /docker-entrypoint.d/50-init-baikal.sh
COPY init-baikal.php /usr/local/bin/init-baikal.php

RUN chmod +x /docker-entrypoint.d/50-init-baikal.sh