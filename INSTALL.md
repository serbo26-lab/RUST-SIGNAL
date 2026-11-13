# Установка RUST-SIGNAL на VPS

Команды выполняются **на VPS под root**. Выберите один способ. Все адреса вида `game.example.com` и пути `/var/www/example-game` — примеры: их надо заменить на свои. Адреса скриптов в GitHub менять не нужно.

## 1. Чистый VPS — игра и глобальный рейтинг

Основной установщик `deploy/vps.sh` устанавливает игру, Nginx, Node.js и API/SQLite рейтинга.

| ОС | Пакетный менеджер | Статус |
| --- | --- | --- |
| Ubuntu (apt) | `apt-get` | Проверено на Ubuntu 26.04 |
| Debian 13 (trixie) | `apt-get` | Проверено на реальном VPS |
| CentOS Stream 9 | `dnf` | Проверено на чистом VPS: Nginx, игра, рейтинг и HTTP |\n| Rocky / AlmaLinux | `dnf` | Поддержка предусмотрена в установщике; на отдельном VPS не проверено |
| FreeBSD 15 (amd64) | `pkg`, служба `rc.d` | Проверено на реальном VPS |

### Debian / Ubuntu

```sh
apt-get update
apt-get install -y ca-certificates curl
curl -fsSL https://raw.githubusercontent.com/serbo26-lab/RUST-SIGNAL/main/deploy/vps.sh -o /tmp/rust-signal-vps.sh
sh -n /tmp/rust-signal-vps.sh
sh /tmp/rust-signal-vps.sh install
```

### CentOS Stream / Rocky Linux / AlmaLinux

```sh
dnf install -y ca-certificates curl
curl -fsSL https://raw.githubusercontent.com/serbo26-lab/RUST-SIGNAL/main/deploy/vps.sh -o /tmp/rust-signal-vps.sh
sh -n /tmp/rust-signal-vps.sh
sh /tmp/rust-signal-vps.sh install
```

Если на CentOS/RHEL активен `firewalld`, основной установщик разрешает **HTTP (порт 80)** в действующих и постоянных настройках стандартной зоны. Другие правила и HTTPS он не меняет. На проверенном CentOS Stream 9 SELinux был отключён; режим **Enforcing ещё не проверен**.

### FreeBSD 15 (amd64)

```sh
curl -fsSL https://raw.githubusercontent.com/serbo26-lab/RUST-SIGNAL/main/deploy/vps.sh -o /tmp/rust-signal-vps.sh
sh -n /tmp/rust-signal-vps.sh
sh /tmp/rust-signal-vps.sh install
```

Для FreeBSD используется `pkg`, Nginx в `/usr/local/etc/nginx`, Node.js 24 и служба `rust_signal_leaderboard` через `rc.d`. База результатов сохраняется в `/var/db/rust-signal/leaderboard/`.

### Если сайт нужен на домене

Во всех трёх командах установки выше замените последнюю строку на:

```sh
DOMAIN='game.example.com'
sh /tmp/rust-signal-vps.sh install "$DOMAIN"
```

**Заменить:** `game.example.com` на ваш домен, DNS которого указывает на VPS. Установщик создаёт HTTP-сайт; **HTTPS-сертификат автоматически не выпускается**. Если домен уже используется другим Nginx-сайтом, обычный установщик не должен его захватывать — используйте способ 2 ниже.

### Обновление (все ОС)

```sh
curl -fsSL https://raw.githubusercontent.com/serbo26-lab/RUST-SIGNAL/main/deploy/vps.sh -o /tmp/rust-signal-vps.sh
sh -n /tmp/rust-signal-vps.sh
sh /tmp/rust-signal-vps.sh update
```

Домен при обновлении **повторять не требуется**. База рейтинга сохраняется.

## 2. Linux: заменить действующий отдельный Nginx-сайт

**Только Linux с systemd и Nginx.** Старый сайт на указанном домене будет заменён; оригинальные конфигурации сохраняются в резервной копии. Действующий `default_server` или общий конфиг нескольких доменов этим способом заменять нельзя.

```sh
DOMAIN='game.example.com'
curl -fsSL https://raw.githubusercontent.com/serbo26-lab/RUST-SIGNAL/main/deploy/replace-domain.sh -o /tmp/rust-signal-replace.sh
sh -n /tmp/rust-signal-replace.sh
sh /tmp/rust-signal-replace.sh "$DOMAIN"
```

**Заменить:** только `game.example.com` на домен существующего сайта. Обновлять после этого нужно командой `vps.sh update` из способа 1, а **не** повторно запускать `replace-domain.sh`.

Ограничение: отдельные старые маршруты `/.well-known/acme-challenge/` не переносятся автоматически; после замены проверьте механизм продления сертификата.

## 3. Linux: только файлы игры в существующий веб-каталог

**Только Linux.** Nginx, VPN, HTTPS и порты не изменяются. В каталоге уже должен существовать `index.html`, без посторонних файлов (кроме `.well-known`). Этот способ **не устанавливает онлайн-рейтинг**.

```sh
DOMAIN='game.example.com'
WEBROOT='/var/www/example-game'
curl -fsSL https://raw.githubusercontent.com/serbo26-lab/RUST-SIGNAL/main/deploy/selfmask-webroot.sh -o /tmp/rust-signal-webroot.sh
sh -n /tmp/rust-signal-webroot.sh
sh /tmp/rust-signal-webroot.sh install "$DOMAIN" "$WEBROOT"
```

**Заменить:** `DOMAIN` — домен сайта; `WEBROOT` — полный путь к его существующему веб-каталогу.

Обновление (подставьте те же два значения):

```sh
DOMAIN='game.example.com'
WEBROOT='/var/www/example-game'
curl -fsSL https://raw.githubusercontent.com/serbo26-lab/RUST-SIGNAL/main/deploy/selfmask-webroot.sh -o /tmp/rust-signal-webroot.sh
sh /tmp/rust-signal-webroot.sh update "$DOMAIN" "$WEBROOT"
```

## 4. Linux: готовый Nginx stream/SNI-шлюз

**Только Linux.** Применяйте, лишь если публичный TCP/443 обслуживает Nginx stream (`ssl_preread`), а маршрут `default` уже ведёт на внутренний HTTPS-порт Nginx, не на VPN.

```sh
DOMAIN='game.example.com'
HTTPS_PORT='8443'
CERT='/etc/ssl/example-game/fullchain.pem'
KEY='/etc/ssl/example-game/privkey.pem'
MAP_NAME='tls_routes'

curl -fsSL https://raw.githubusercontent.com/serbo26-lab/RUST-SIGNAL/main/deploy/stream-default-site.sh -o /tmp/rust-signal-stream.sh
sh -n /tmp/rust-signal-stream.sh
sh /tmp/rust-signal-stream.sh install "$DOMAIN" "$HTTPS_PORT" "$CERT" "$KEY" "$MAP_NAME"
```

**Заменить все пять значений:** домен, *уже работающий* внутренний HTTPS-порт, пути к действующим сертификату и ключу, а также имя переменной SNI-`map` без `$`. `8443` и `tls_routes` — примеры. Сертификат установщик не выпускает.

Для обновления снова скачайте скрипт и используйте:

```sh
sh /tmp/rust-signal-stream.sh update "$DOMAIN" "$HTTPS_PORT" "$CERT" "$KEY" "$MAP_NAME"
```

## Проверка

Для HTTP по IP:

```sh
curl -I http://127.0.0.1/
curl -I http://127.0.0.1/play/
curl -fsS http://127.0.0.1/api/health
```

Для домена подставьте домен вместо `127.0.0.1` и используйте `https://`, **если HTTPS уже настроен**. Для способа 3 проверка `/api/health` неприменима.

Состояние службы рейтинга: на Linux — `systemctl status rust-signal-leaderboard`, на FreeBSD — `service rust_signal_leaderboard status`.
