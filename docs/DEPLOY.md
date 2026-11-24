# Развёртывание

Один сервер (Ubuntu 24.04+ / Debian 13), без Docker: nginx → uvicorn (`127.0.0.1:8010`) → PgBouncer → PostgreSQL 16+. Конфиги лежат в `deploy/`. Везде замените `game.example.com` на свой домен. Команды — от root, из `/srv/wasteland/app`.

## 1. Что нужно заранее

- Сервер, домен с записями A/AAAA на него, второй хост для бэкапов (доступ по SSH-ключу).
- Аккаунт Resend и бот от @BotFather (отдельный от тестового).
- Почта и имя владельца игры: они публикуются в `/privacy` и `/delete-account`. До запуска покажите политику юристу (152-ФЗ, передача адресов в Resend — США).

## 2. Пакеты, пользователь, код

```bash
apt install nginx postgresql pgbouncer certbot git curl rsync sudo
# Node.js 22+ — из NodeSource или другого доверенного источника; uv — в /usr/local/bin/uv.
useradd --system --create-home --home-dir /srv/wasteland --shell /usr/sbin/nologin wasteland
chmod 755 /srv/wasteland
sudo -u wasteland -H git clone <адрес репозитория> /srv/wasteland/app
install -d -o wasteland -g wasteland /srv/wasteland/web
sudo -u wasteland -H /usr/local/bin/uv python install 3.12
cd /srv/wasteland/app
```

## 3. База и PgBouncer

```bash
sudo -u postgres createuser --pwprompt wasteland      # пароль: openssl rand -hex 24
sudo -u postgres createdb --owner=wasteland wasteland
cp deploy/pgbouncer/pgbouncer.ini /etc/pgbouncer/pgbouncer.ini
# Проверочная строка SCRAM подходит, если она одинакова в PostgreSQL и userlist.txt:
sudo -u postgres psql -Atc "select format('\"%s\" \"%s\"', usename, passwd) from pg_shadow where usename='wasteland'" > /etc/pgbouncer/userlist.txt
chown postgres:postgres /etc/pgbouncer/userlist.txt && chmod 600 /etc/pgbouncer/userlist.txt
systemctl restart pgbouncer
```

PgBouncer и PostgreSQL должны слушать только localhost. Пул соединений — transaction; миграции и `pg_dump` ходят напрямую в PostgreSQL (5432). Если на сервере уже есть PgBouncer, не заменяйте его файл, а добавьте базу в `[databases]` и строку в `userlist.txt`.

## 4. Секреты

```bash
install -d -m 750 -g wasteland /etc/wasteland
install -m 640 -g wasteland deploy/wasteland.env.example /etc/wasteland/wasteland.env
install -m 600 deploy/deploy.env.example /etc/wasteland/deploy.env
install -m 600 deploy/backup.env.example /etc/wasteland/backup.env
```

Заполните файлы. `JWT_SECRET` и `TELEGRAM_WEBHOOK_SECRET` — по `openssl rand -hex 32`. Смена `JWT_SECRET` завершает access-токены и незавершённые входы по коду. Сервис не стартует с небезопасными настройками (`check_config`): не HTTPS, короткий секрет, `MAIL_BACKEND=console`, неполные настройки Resend или Telegram.

## 5. nginx и TLS

```bash
install -d /var/www/letsencrypt
cp deploy/nginx/wasteland-limits.conf /etc/nginx/conf.d/
cp deploy/nginx/wasteland-{headers,proxy}.conf /etc/nginx/snippets/
for f in wasteland-http wasteland; do
  sed 's/game.example.com/ВАШ_ДОМЕН/g' deploy/nginx/$f.conf > /etc/nginx/sites-available/$f.conf
done
ln -s ../sites-available/wasteland-http.conf /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
certbot certonly --webroot -w /var/www/letsencrypt -d ВАШ_ДОМЕН --deploy-hook 'systemctl reload nginx'
ln -s ../sites-available/wasteland.conf /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
certbot renew --dry-run
```

Адрес клиента берётся из `X-Forwarded-For`, который nginx перезаписывает. Если перед сервером появится CDN, настройте `real_ip`, иначе лимиты будут общими на всех. Журнал nginx не содержит query-строк и Referer (в ссылке входа — одноразовый токен); срок его хранения — 14 дней (`rotate 14` в `/etc/logrotate.d/nginx`), как обещано в политике.

## 6. Сервисы и первая выкладка

```bash
cp deploy/systemd/* /etc/systemd/system/ && systemctl daemon-reload
systemctl enable wasteland-api
deploy/deploy.sh            # далее — так же для обновлений; можно указать тег или коммит
systemctl enable --now wasteland-cleanup.timer wasteland-backup.timer
```

`deploy.sh` обновляет код, собирает клиент, проверяет настройки, применяет миграции, перезапускает API, ждёт `/health` и только потом публикует клиент. Откат кода: `deploy/deploy.sh <прошлый коммит>`; миграции назад сам не откатывает. Если обновление меняет `content/`, забеги, начатые до перезапуска, получат флаг `content_hash_mismatch`.

## 7. Почта и Telegram

- **Resend:** добавьте домен-отправитель и внесите в DNS показанные там записи SPF и DKIM, затем DMARC: `_dmarc TXT "v=DMARC1; p=none; rua=mailto:ВАША_ПОЧТА"`; после проверки отчётов — `p=quarantine`. `MAIL_FROM` должен быть на этом домене.
- **Бот:** `systemd-run --wait --pipe --collect --uid=wasteland -p EnvironmentFile=/etc/wasteland/wasteland.env -p WorkingDirectory=/srv/wasteland/app/server /srv/wasteland/app/server/.venv/bin/python -m app.services.telegram_webhook set`. С аргументом `info` — состояние и последняя ошибка. `make bot-poll` с боевым токеном не запускать: он удалит вебхук.

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
2. Гость, забег, покупка улучшения; вход по письму (ссылкой и кодом) на Gmail, Яндекс и Mail.ru — письмо во «Входящих»; в заголовках SPF, DKIM и DMARC = pass.
3. Вход через Telegram; `telegram_webhook info` без ошибок.
4. `/privacy` и `/delete-account` открываются, в них настоящие контакты. Удалите тестовый аккаунт по почте и через Telegram.
5. 15 быстрых `POST /api/v1/auth/guest` → последние 429 с JSON.
6. `systemctl list-timers 'wasteland-*'`; `systemctl start wasteland-cleanup` завершился без ошибок; восстановление бэкапа прошло.
7. Перезагрузите сервер: игра поднялась сама.

## 10. Android (в самом конце)

Имя пакета, ключ, `ANDROID_PACKAGE` и `ANDROID_CERT_FINGERPRINTS`, затем `https://домен/.well-known/assetlinks.json`, App Links, закрытый тест Play (README, раздел Android). Ссылки для Play Console: `/privacy` и `/delete-account`.
