# Развёртывание

Один сервер (Ubuntu 24.04+ / Debian 13), без Docker: nginx → uvicorn (`127.0.0.1:8010`) → PostgreSQL 16+ (через PgBouncer, если он есть). На сервере могут жить и другие сайты. Конфиги лежат в `deploy/`. Команды — от root, из каталога репозитория.

| Что | Где |
| --- | --- |
| Код (git clone) | `/var/www/webii/wasteland.lol/frpg` |
| Готовый сайт, корень nginx | `/var/www/webii/wasteland.lol/web` |
| Своя Node.js | `…/wasteland.lol/node` |
| Секреты | `/etc/wasteland/` |
| Бэкапы | `/var/lib/wasteland-backups/` |

Домен в файлах — `wasteland.lol`. Если домен или путь другие, замените их в `deploy/nginx/*.conf`, `deploy/systemd/*.service` и `wasteland.env`; `deploy.sh` сам находит путь по своему расположению.

## 1. Что нужно заранее

- Сервер: от 1 ГБ свободной памяти на сборку (на 1 ГБ добавьте 1–2 ГБ swap, иначе сборка клиента может не пройти), 5 ГБ диска, открыты порты 80 и 443.
- Домен с записями A/AAAA на сервер (AAAA — только если IPv6 работает, иначе сертификат не выдадут), второй хост для бэкапов с `rsync` и доступом по SSH-ключу.
- Необязательно: аккаунт Resend и бот от @BotFather (отдельный от тестового). Основной вход — по ключу аккаунта; почту и Telegram можно включить позже.
- Код отправлен в `origin/master` (`git push`) и CI зелёный: сервер берёт код оттуда, а не с вашего компьютера.
- Почта и имя владельца игры: они публикуются в `/privacy` и `/delete-account`. До запуска покажите политику юристу (152-ФЗ, передача адресов в Resend — США).

## 1а. На сервере уже есть другие сайты

Ничего общего не перезаписываем: свои файлы с префиксом `wasteland`, свой порт, своя база. Сначала посмотрите, что занято:

```bash
ss -ltnp | grep -E ':(80|443|8010|5432|6432)\b'    # 80/443 должен держать nginx, 8010 — быть свободен
nginx -v; nginx -t; nginx -T 2>/dev/null | grep -E 'listen|include .*(sites-enabled|conf.d)|default_server'
id wasteland; ls /etc/nginx/snippets /etc/nginx/conf.d 2>/dev/null
pg_lsclusters; sudo -u postgres psql -l | grep wasteland
node --version; ufw status
cp -a /etc/nginx /root/nginx-backup-$(date +%F)
```

- **80/443 занят не nginx** (Apache, Caddy, Docker, панель) — не продолжайте: добавьте домен в ту систему, проксируя `/api/` и `/.well-known/assetlinks.json` на `127.0.0.1:8010`, остальное — файлы из каталога `web` (заголовки и правила — в `deploy/nginx/`).
- **Порт 8010 занят** — выберите другой и поставьте его в `API_PORT` и в `wasteland-proxy.conf`.
- **Другие сайты слушают конкретный IP** (`listen 1.2.3.4:443`) — впишите тот же адрес в `listen` наших файлов, иначе запросы до игры не дойдут.
- **`nginx -t` уже ругается** до наших правок — сначала почините это.
- **Нет `sites-enabled` или `snippets`** в конфиге — положите наши два сайта в `conf.d/`, а каталог `snippets` создайте: `include snippets/…` ищется в `/etc/nginx/`.

## 2. Пакеты, пользователь, код

Ставьте только то, чего нет; имеющиеся nginx, PostgreSQL, PgBouncer и Node не обновляйте.

```bash
apt-get install --no-upgrade nginx postgresql certbot git curl rsync sudo xz-utils python3-venv
python3 --version        # нужен 3.12–3.14 (Ubuntu 24.04 и Debian 13 подходят)
BASE=/var/www/webii/wasteland.lol
OWNER=$(stat -c %U $BASE/frpg); sudo -u $OWNER git -C $BASE/frpg remote -v; sudo -u $OWNER git -C $BASE/frpg status -sb   # git clone, без своих правок
stat -c '%U %a %n' /var/www/webii $BASE $BASE/frpg               # владелец не root, есть вход (x)
# Отдельный пользователь службы: читает код, но не меняет его
useradd --system --create-home --home-dir /srv/wasteland --shell /usr/sbin/nologin wasteland
for u in wasteland www-data; do sudo -u $u test -x $BASE && echo "$u: ok" || echo "$u: НЕТ ДОСТУПА"; done
# Своя Node.js (22.13+), чтобы не трогать системную; на ARM-сервере замените x64 на arm64
cd /tmp && curl -fsSLO https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt
NODE=$(awk '/linux-x64.tar.xz$/ {print $2}' SHASUMS256.txt)
curl -fsSLO https://nodejs.org/dist/latest-v22.x/$NODE
grep " $NODE\$" SHASUMS256.txt | sha256sum -c -                    # должно быть: OK
install -d $BASE/node && tar -xJf $NODE -C $BASE/node --strip-components=1
$BASE/node/bin/node --version
cd $BASE/frpg
```

Если доступа нет, дайте только проход, не открывая содержимое: `apt-get install --no-upgrade acl; setfacl -m u:wasteland:x,u:www-data:x /var/www/webii $BASE`. Если репозиторий принадлежит root, отдайте его обычному пользователю сайта: `chown -R webii: $BASE` (имя проверьте). Зависимости ставит владелец репозитория: Python — обычный `venv` в `server/.venv` с точными версиями из `server/requirements.txt`; сервис работает от `wasteland`.

**Корень сайта — только `web`.** Если для домена уже есть сайт nginx с корнем `/var/www/webii/wasteland.lol`, отключите его: иначе наружу попадут исходники и `frpg/.git`.

`deploy.sh` берёт Node из `node/bin` рядом с репозиторием, а если её нет — системную. Репозиторий публичный, ключ не нужен; если закроете его, создайте владельцу репозитория ключ (`ssh-keygen -t ed25519`) и добавьте как Deploy key только на чтение.

Файрвол: если `ufw` уже включён, проверьте, что 80 и 443 открыты. Не включайте его впервые ради игры: можно закрыть порты других сервисов.

## 3. База

```bash
sudo -u postgres createuser --pwprompt wasteland      # пароль: openssl rand -hex 24
sudo -u postgres createdb --owner=wasteland wasteland
psql 'postgresql://wasteland:ПАРОЛЬ@127.0.0.1:5432/wasteland' -c 'select 1'
```

Порт возьмите из `pg_lsclusters`, нужна версия 16+. PostgreSQL должен слушать только localhost. Если кластеров несколько, добавьте к командам `-p ПОРТ`.

**PgBouncer необязателен.** Если его нет, не ставьте: в `DATABASE_URL` укажите порт PostgreSQL (5432). Если он уже работает, не заменяйте `pgbouncer.ini` и не перезапускайте службу, а добавьте своё и перечитайте настройки:

```bash
# в /etc/pgbouncer/pgbouncer.ini, раздел [databases]:
#   wasteland = host=127.0.0.1 port=5432 dbname=wasteland pool_mode=transaction
sudo -u postgres psql -Atc "select format('\"%s\" \"%s\"', usename, passwd) from pg_shadow where usename='wasteland'" >> /etc/pgbouncer/userlist.txt
systemctl reload pgbouncer
psql 'postgresql://wasteland:ПАРОЛЬ@127.0.0.1:6432/wasteland' -c 'select 1'
```

Для этого у него должно быть `auth_type = scram-sha-256` и `auth_file`; если настроено иначе, идите напрямую в PostgreSQL. `deploy/pgbouncer/pgbouncer.ini` — пример только для сервера без PgBouncer. Миграции и `pg_dump` всегда ходят напрямую.

## 4. Секреты

```bash
install -d -m 750 -g wasteland /etc/wasteland
install -m 640 -g wasteland deploy/wasteland.env.example /etc/wasteland/wasteland.env
install -m 600 deploy/deploy.env.example /etc/wasteland/deploy.env
install -m 600 deploy/backup.env.example /etc/wasteland/backup.env
```

Заполните файлы. `JWT_SECRET` и `TELEGRAM_WEBHOOK_SECRET` — по `openssl rand -hex 32`. Пароль базы подставьте в `DATABASE_URL`, `MIGRATION_DATABASE_URL` и `BACKUP_DATABASE_URL`; имя владельца с пробелами — в кавычках.

**`JWT_SECRET` сохраните отдельно от сервера** (менеджер паролей): из него выводятся ключи аккаунтов, и в бэкап базы он не входит, как и весь `/etc/wasteland`. При его смене завершаются access-токены и незавершённые входы по коду, а ключ аккаунта меняется, когда игрок снова откроет его в настройках: до этого работает старый, после — только новый.

Сервис не стартует с небезопасными настройками (`check_config`): не HTTPS, короткий секрет, `MAIL_BACKEND=console`, неполные настройки Resend или Telegram. Без почты поставьте `MAIL_BACKEND=disabled`, без Telegram оставьте все три `TELEGRAM_*` пустыми: их кнопки в игре и на странице удаления скроются, останутся «Новая игра» и вход по ключу. Чтобы включить позже, заполните файл и `systemctl restart wasteland-api`.

## 5. nginx и TLS

Если nginx ещё нет ни одного чужого сайта, шаги те же. После каждого шага — `nginx -t`; перезагрузка идёт через `reload`, он не рвёт соединения других сайтов.

```bash
DOMAIN=wasteland.lol
install -d /var/www/letsencrypt /etc/nginx/snippets
install -d -o www-data -g adm -m 750 /var/log/nginx/wasteland
install -m 644 deploy/logrotate/wasteland /etc/logrotate.d/wasteland-nginx
cp -n deploy/nginx/wasteland-limits.conf /etc/nginx/conf.d/
cp -n deploy/nginx/wasteland-{headers,proxy}.conf /etc/nginx/snippets/
for f in wasteland-http wasteland; do
  cp -n deploy/nginx/$f.conf /etc/nginx/sites-available/
done
ln -s ../sites-available/wasteland-http.conf /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
certbot certonly --webroot -w /var/www/letsencrypt -d $DOMAIN --deploy-hook 'nginx -t && systemctl reload nginx'
ln -s ../sites-available/wasteland.conf /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
certbot renew --dry-run --cert-name $DOMAIN
```

`certonly --webroot` не правит конфиги nginx (не запускайте `certbot --nginx`). После включения откройте остальные сайты и убедитесь, что они работают.

Проверка, что исходники не видны: `curl -sI https://$DOMAIN/.git/config` и `/frpg/.git/config` отдают страницу игры (`text/html`), а не файл.

**Откат:** `rm /etc/nginx/sites-enabled/wasteland{,-http}.conf /etc/nginx/conf.d/wasteland-limits.conf && nginx -t && systemctl reload nginx`.

Что общего с другими сайтами: в `conf.d` объявлены только зоны `wl_*` и формат журнала `wasteland`, сами лимиты, заголовки (HSTS, CSP), gzip и журналы заданы внутри нашего `server`. `default_server` и `http2` в `listen` не используются. HSTS без `includeSubDomains`.

Адрес клиента берётся из `X-Forwarded-For`, который nginx перезаписывает. Если перед сервером CDN, настройте `real_ip`, иначе лимиты будут общими на всех. Журнал игры не содержит query-строк и Referer, лежит в `/var/log/nginx/wasteland/` и хранится 14 дней, как обещано в политике.

## 6. Сервисы и первая выкладка

```bash
cp deploy/systemd/wasteland-* /etc/systemd/system/ && systemctl daemon-reload
systemctl enable wasteland-api
deploy/deploy.sh            # далее — так же для обновлений; можно указать тег или коммит
systemctl enable --now wasteland-cleanup.timer wasteland-backup.timer
```

Перед обновлением с миграциями сделайте бэкап: `systemctl start wasteland-backup`. Предупредите игроков: забеги, идущие в момент обновления, могут получить флаг.

`deploy.sh` обновляет код, собирает клиент, проверяет настройки, применяет миграции, перезапускает API, ждёт `/health` и только потом публикует клиент. Откат кода: `deploy/deploy.sh <прошлый коммит>`; миграции назад сам не откатывает. Если обновление меняет `content/`, забеги, начатые до перезапуска, получат флаг `content_hash_mismatch`.

## 7. Почта и Telegram (если включаете)

- **Resend:** добавьте домен-отправитель и внесите в DNS показанные там записи SPF и DKIM, затем DMARC: `_dmarc TXT "v=DMARC1; p=none; rua=mailto:ВАША_ПОЧТА"`; после проверки отчётов — `p=quarantine`. `MAIL_FROM` должен быть на этом домене.
- **Бот:** `systemd-run --wait --pipe --collect --uid=wasteland -p EnvironmentFile=/etc/wasteland/wasteland.env -p WorkingDirectory=/var/www/webii/wasteland.lol/frpg/server /var/www/webii/wasteland.lol/frpg/server/.venv/bin/python -m app.services.telegram_webhook set`. С аргументом `info` — состояние и последняя ошибка. `make bot-poll` с боевым токеном не запускать: он удалит вебхук.

## 7а. Администратор

Права админа выдаются только из консоли сервера. `ID аккаунта` виден в игре: «Настройки» → «Аккаунт». Вместо ID подойдёт почта, если аккаунт входит по почте.

```bash
systemd-run --wait --pipe --collect --uid=wasteland -p EnvironmentFile=/etc/wasteland/wasteland.env -p WorkingDirectory=/var/www/webii/wasteland.lol/frpg/server /var/www/webii/wasteland.lol/frpg/server/.venv/bin/python -m app.services.admin grant ID_ИЛИ_ПОЧТА
```

`revoke ID_ИЛИ_ПОЧТА` снимает права, `list` показывает всех админов. После выдачи обновите страницу: в настройках появится кнопка «Админ-панель» (статистика, игроки, выдача крышек и изумрудов, подозрительные забеги, журнал действий). Все выдачи и смены прав пишутся в таблицу `admin_actions`. Локально то же самое: `make admin WHO=…`, `make admin-revoke WHO=…`, `make admins`.

## 8. Бэкапы и восстановление

Ключ SSH пользователя `wasteland` добавьте на второй хост, один раз подключитесь вручную (`sudo -u wasteland -H ssh …`), затем `systemctl start wasteland-backup && journalctl -u wasteland-backup -n 20`. Копии — в `/var/lib/wasteland-backups` и на втором хосте, 14 дней; `BACKUP_KEEP_DAYS` и `VITE_BACKUP_DAYS` должны совпадать. Второй хост зеркалит сервер: это защита от потери сервера, но не от его взлома — при желании делайте там снимки.

Проверка восстановления (раз в месяц):

```bash
sudo -u postgres createdb --owner=wasteland wasteland_restore
pg_restore --no-owner -d postgresql://wasteland:…@127.0.0.1:5432/wasteland_restore <файл.dump>
psql postgresql://wasteland:…@127.0.0.1:5432/wasteland_restore -c 'select count(*) from users'
sudo -u postgres dropdb wasteland_restore
```

## 9. Проверка вручную

1. `https://домен/api/v1/health` → `ok`; `http://` перенаправляет на `https://`; `https://домен/docs` отдаёт игру, а не документацию API.
2. Новая игра, забег, покупка улучшения. Если включена почта: вход по письму (ссылкой и кодом) на Gmail, Яндекс и Mail.ru — письмо во «Входящих»; в заголовках SPF, DKIM и DMARC = pass.
3. Если включён Telegram: вход через бота; `telegram_webhook info` без ошибок.
4. `/privacy` и `/delete-account` открываются, в них настоящие контакты. Удалите тестовый аккаунт в игре, а если включены — по почте и через Telegram.
5. 15 быстрых `POST /api/v1/auth/guest` → последние 429 с JSON.
6. `systemctl list-timers 'wasteland-*'`; `systemctl start wasteland-cleanup` завершился без ошибок; восстановление бэкапа прошло.
7. Ключ: «Настройки» → «Показать», войдите по нему в другом браузере — тот же баланс; неверный ключ даёт ошибку. Кнопка «Копировать» работает только по HTTPS.
8. После забега с убийством 100 врагов на вкладке «Достижения» есть «Забрать»; изумруды прибавились. Закрытый герой выбрать нельзя.
9. С телефона: вертикально и после поворота игра занимает экран, звук и мелодии играют, в консоли браузера нет ошибок CSP (предупреждение Zod про `new Function` допустимо).
10. Автозапуск: `systemctl is-enabled wasteland-api wasteland-cleanup.timer wasteland-backup.timer` → `enabled`. Перезагружать сервер с другими сайтами не нужно.
11. Другие сайты на сервере открываются, `nginx -t` без новых предупреждений.

Прогресс с домашнего компьютера на сервер не переносится: база там новая.

## 10. Android (в самом конце)

Имя пакета, ключ, `ANDROID_PACKAGE` и `ANDROID_CERT_FINGERPRINTS`, затем `https://домен/.well-known/assetlinks.json`, App Links, закрытый тест Play (README, раздел Android). Ссылки для Play Console: `/privacy` и `/delete-account`.
