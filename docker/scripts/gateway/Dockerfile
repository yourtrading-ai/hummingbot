# syntax=docker/dockerfile-upstream:1-labs
FROM node:16.3.0

# Set labels
LABEL application="gateway-v2"
LABEL branch=${BRANCH}
LABEL commit=${COMMIT}
LABEL date=${BUILD_DATE}

# Set ENV variables
ENV COMMIT_BRANCH=${BRANCH}
ENV COMMIT_SHA=${COMMIT}
ENV BUILD_DATE=${DATE}
ENV GATEWAY_PASSPHRASE=""

ARG DEBIAN_FRONTEND=noninteractive
ARG TZ="Etc/GMT"

WORKDIR /root

# Dropping default /root/.bashrc because it will return if not running as interactive shell, thus not invoking PATH settings
RUN :> /root/.bashrc

SHELL [ "/bin/bash", "-lc" ]

RUN \
	apt-get update \
	&& apt-get install --no-install-recommends -y \
		ca-certificates \
		openssh-server \
		git

COPY . .

EXPOSE 15888

RUN \
	mkdir -p \
	/root/gateway/db \
	/root/gateway/logs \
	/root/gateway/gateway.level \
	/root/gateway/transactions.level \
	/root/gateway/logs \
	/root/gateway/conf \
	/root/.hummingbot-gateway/conf \
	/root/.hummingbot-gateway/certs \
	/root/.hummingbot-gateway/logs \
	/var/lib/gateway

RUN cp -R /root/gateway/src/templates/* /root/gateway/conf/

WORKDIR /root/gateway

RUN yarn
RUN yarn build

#RUN <<-EOF
#	apt autoremove -y
#
#	apt clean autoclean
#
#	rm -rf \
#		/var/lib/apt/lists/* \
#		/etc/apt/sources.list \
#		/etc/apt/sources.list.d/*
#EOF

CMD ["yarn", "start"]
