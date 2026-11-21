FROM node:22-alpine AS build
WORKDIR /src
COPY . .
RUN --mount=type=secret,id=build_ca --mount=type=tmpfs,target=/root/.npm \
    if [ -s /run/secrets/build_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/build_ca; fi; \
    npm ci --no-audit --no-fund && npm run build && chmod -R a=rX dist && rm -rf node_modules

FROM nginxinc/nginx-unprivileged:1.28-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /src/dist /usr/share/nginx/html
