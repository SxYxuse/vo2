# BRouter, the route builder's bike router (ADR 0062), from its official release. The images on
# ghcr.io stop at 1.7.8, whose lookup table no longer reads the weekly brouter.de map tiles.
FROM eclipse-temurin:21-jre-noble

ARG BROUTER_VERSION=1.7.10
ARG BROUTER_SHA256=023fec3ba997758e8cd7ab9e1bae52e962af3f00b57683e3de86b84ffad01532

RUN apt-get update \
    && apt-get install -y --no-install-recommends unzip \
    && rm -rf /var/lib/apt/lists/* \
    && curl -fsSL -o /tmp/brouter.zip \
       "https://github.com/abrensch/brouter/releases/download/v${BROUTER_VERSION}/brouter-${BROUTER_VERSION}.zip" \
    && echo "${BROUTER_SHA256}  /tmp/brouter.zip" | sha256sum -c - \
    && unzip -q /tmp/brouter.zip -d /tmp \
    && mkdir -p /app /segments4 /customprofiles \
    && mv "/tmp/brouter-${BROUTER_VERSION}/brouter-${BROUTER_VERSION}-all.jar" /app/brouter.jar \
    && mv "/tmp/brouter-${BROUTER_VERSION}/profiles2" /profiles2 \
    && rm -rf /tmp/brouter* \
    && chown -R ubuntu:ubuntu /customprofiles

USER ubuntu
EXPOSE 17777

# Map tiles are mounted at /segments4; see scripts/brouter-segments.ts. Four threads and a 1 GB
# heap route a 160 km loop; the stock start script allows one thread and 128 MB.
CMD ["java", "-Xmx1024M", "-Xms256M", "-Xmn32M", "-DmaxRunningTime=60", "-DuseRFCMimeType=false", \
     "-cp", "/app/brouter.jar", "btools.server.RouteServer", \
     "/segments4", "/profiles2", "/customprofiles", "17777", "4"]
