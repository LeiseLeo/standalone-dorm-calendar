# Build the Hugo site, then serve it and proxy Baikal through the same origin.
FROM hugomods/hugo:exts AS build
WORKDIR /src
ARG SITE_TITLE=WG-Kalender
ARG SITE_URL=http://localhost:8080/
ENV SITE_TITLE=$SITE_TITLE
ENV SITE_URL=$SITE_URL
COPY site/ ./
RUN hugo --minify --baseURL "$SITE_URL"

FROM nginx:1.27-alpine
COPY --from=build /src/public/ /usr/share/nginx/html/
COPY nginx/default.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
