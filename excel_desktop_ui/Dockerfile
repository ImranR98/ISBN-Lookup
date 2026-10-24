FROM batonogov/pyinstaller-linux@sha256:c999ab2fe11e4430b810c5ae2685a9bef736e5fae4a00b9dc1b77d119523e6f3 AS linux-builder
ARG DEFAULT_API_HOST="http://localhost:8080"
ARG DEFAULT_API_KEY=""
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY isbn_lookup_excel_desktop_ui.py ./
RUN echo "# This file is auto-generated during build" > build_config.py && \
    echo "DEFAULT_API_HOST = '${DEFAULT_API_HOST}'" >> build_config.py && \
    echo "DEFAULT_API_KEY = '${DEFAULT_API_KEY}'" >> build_config.py

FROM batonogov/pyinstaller-windows@sha256:d718ceb48e5d49a83ae17ab0cc60d617b01fab72efd6fc61d02486a748e04b5a AS windows-builder
ARG DEFAULT_API_HOST="http://localhost:8080"
ARG DEFAULT_API_KEY=""
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY isbn_lookup_excel_desktop_ui.py ./
RUN echo "# This file is auto-generated during build" > build_config.py && \
    echo "DEFAULT_API_HOST = '${DEFAULT_API_HOST}'" >> build_config.py && \
    echo "DEFAULT_API_KEY = '${DEFAULT_API_KEY}'" >> build_config.py