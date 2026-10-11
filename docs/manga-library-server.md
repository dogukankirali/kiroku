# Manga library server

The manga reader opens CBZ files straight from your own server; Kiroku only stores reading progress. Locally, `node scripts/manga-library.mjs` serves `Downloads/Kiroku/Manga` on `http://localhost:8788`. On a home server the same folder is served by Caddy behind a Cloudflare Tunnel, with no open ports and no code changes.

This file contains no secrets. Keep the password, its hash and the tunnel token in the server's `.env` and never commit them.

## 1. Move the files

Copy each series folder from `Downloads/Kiroku/Manga/<Series>/` to the server's manga folder (SMB share or rsync). Keep the layout: one folder per series containing its `.cbz` files, `series.json` and `cover.jpg`. The copies on the PC can be deleted afterwards.

## 2. Caddy and cloudflared (Docker)

`Caddyfile`:

```
:80 {
	header {
		Access-Control-Allow-Origin "https://app.dogukankirali.com"
		Access-Control-Allow-Headers "Accept, Authorization, Range"
		Access-Control-Expose-Headers "Content-Length, Content-Range"
	}
	# Browsers send the CORS preflight without credentials, so it must pass before basic_auth
	@preflight method OPTIONS
	handle @preflight {
		respond 204
	}
	handle {
		basic_auth {
			{$MANGA_USER} {$MANGA_PASSWORD_HASH}
		}
		root * /srv/manga
		file_server browse
	}
}
```

`docker-compose.yml`:

```yaml
services:
  caddy:
    image: caddy:2
    restart: unless-stopped
    env_file: .env
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - ${MANGA_DIR}:/srv/manga:ro
  cloudflared:
    image: cloudflare/cloudflared:latest
    restart: unless-stopped
    command: tunnel --no-autoupdate run
    environment:
      - TUNNEL_TOKEN=${TUNNEL_TOKEN}
```

`.env` (only on the server, never in git):

```
MANGA_DIR=/path/to/Media/Manga
MANGA_USER=kiroku
MANGA_PASSWORD_HASH=...   # docker run --rm caddy caddy hash-password
TUNNEL_TOKEN=...          # from the Cloudflare tunnel page
```

If the hash contains `$` characters, wrap the value in single quotes in `.env`.

## 3. Cloudflare Tunnel

Cloudflare Zero Trust → Networks → Tunnels → create a tunnel and copy its token into `.env`. Add a public hostname, e.g. `manga.<your-domain>` → `http://caddy:80`. Do not put Cloudflare Access in front of it: the reader runs in the browser and cannot pass the Access login. Caddy's password is the protection.

## 4. Kiroku

In the reader's library settings (stored per browser) choose **HTTP (Caddy)**, enter `https://manga.<your-domain>` and the same username and password as in Caddy.

## Notes

- The live site is https, so the library address must be https too; the tunnel provides it.
- To test the server from `localhost:3000`, temporarily allow that origin (or `*`) in `Access-Control-Allow-Origin`.
- While the server is off, the reader cannot open chapters.
- **Salon (anime videos)**: `<video>` cannot send the Basic auth header, so serve the anime folder from a second site block that checks a `?key=` query instead, e.g. `@authed query key={$ANIME_KEY}` → `handle @authed { root * /srv/anime; file_server browse }` and `respond 401` otherwise (keep the same CORS headers and preflight block). Caddy's `file_server` already answers range requests. In Kiroku, enter the address and the key in Salon's library settings.
- Security: the folder is mounted read-only, every request except the preflight needs the password, CORS only allows the Kiroku site, and no port is opened on the home network. Use a long random password; anyone with it can read the library.

---

# Manga kütüphane sunucusu

Manga okuyucu CBZ dosyalarını doğrudan senin sunucundan açar; Kiroku yalnızca okuma ilerlemesini tutar. Yerelde `node scripts/manga-library.mjs`, `İndirilenler/Kiroku/Manga` klasörünü `http://localhost:8788` adresinde sunar. Ev sunucusunda aynı klasörü Cloudflare Tunnel arkasındaki Caddy sunar; port açmak ve kod değiştirmek gerekmez.

Bu dosyada gizli bilgi yok. Şifre, şifre özeti ve tunnel token'ı sunucudaki `.env` dosyasında durur, asla git'e girmez.

## 1. Dosyaları taşı

Her seri klasörünü `İndirilenler/Kiroku/Manga/<Seri>/` altından sunucudaki manga klasörüne kopyala (SMB paylaşımı ya da rsync). Yapı aynı kalsın: her seri bir klasör, içinde `.cbz` dosyaları, `series.json` ve `cover.jpg`. Sonrasında bilgisayardaki kopyalar silinebilir.

## 2. Caddy ve cloudflared (Docker)

`Caddyfile` ve `docker-compose.yml` yukarıdaki İngilizce bölümdekiyle aynı. `.env` yalnızca sunucuda durur:

- `MANGA_DIR`: sunucudaki `Media/Manga` klasörünün yolu
- `MANGA_USER`: kullanıcı adı
- `MANGA_PASSWORD_HASH`: `docker run --rm caddy caddy hash-password` çıktısı (içinde `$` varsa değeri tek tırnağa al)
- `TUNNEL_TOKEN`: Cloudflare tunnel sayfasındaki token

Tarayıcı CORS ön kontrolünü (`OPTIONS`) şifresiz gönderdiği için o istek `basic_auth`'tan önce ayrı bir `handle` bloğunda yanıtlanır.

## 3. Cloudflare Tunnel

Cloudflare Zero Trust → Networks → Tunnels → tunnel oluştur ve token'ını `.env`'e yaz. Public hostname ekle, ör. `manga.<alan-adın>` → `http://caddy:80`. Önüne Cloudflare Access koyma: okuyucu tarayıcıda çalıştığı için Access'in giriş ekranını geçemez. Koruma Caddy'deki şifre.

## 4. Kiroku

Okuyucunun kütüphane ayarlarında (her tarayıcıda ayrı tutulur) **HTTP (Caddy)** seç, adres olarak `https://manga.<alan-adın>` gir, kullanıcı adı ve şifre Caddy'dekiyle aynı olsun.

## Notlar

- Canlı site https olduğu için kütüphane adresi de https olmalı; tunnel bunu sağlıyor.
- Sunucuyu `localhost:3000`'den denemek için `Access-Control-Allow-Origin`'e geçici olarak o adresi (ya da `*`) ekle.
- Sunucu kapalıyken okuyucu bölüm açamaz.
- **Salon (anime videoları)**: `<video>` Basic auth başlığı gönderemediği için anime klasörünü `?key=` sorgusunu kontrol eden ikinci bir site bloğundan sun. Örnek: `@authed query key={$ANIME_KEY}` → `handle @authed { root * /srv/anime; file_server browse }`, diğer durumlarda `respond 401` (aynı CORS başlıkları ve ön kontrol bloğu kalsın). Caddy'nin `file_server`'ı aralıklı istekleri zaten yanıtlar. Kiroku'da adres ve anahtarı Salon'un kütüphane ayarına gir.
- Güvenlik: klasör salt okunur bağlanır, ön kontrol dışındaki her istek şifre ister, CORS yalnızca Kiroku sitesine izin verir ve ev ağında port açılmaz. Uzun, rastgele bir şifre kullan; şifreyi bilen kütüphaneyi okuyabilir.
