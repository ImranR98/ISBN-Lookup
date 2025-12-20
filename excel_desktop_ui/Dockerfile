FROM batonogov/pyinstaller-linux AS linux-builder
ARG DEFAULT_API_HOST="http://localhost:8080"
ARG DEFAULT_API_KEY=""
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY isbn_lookup_excel_desktop_ui.py ./
RUN echo "# This file is auto-generated during build" > build_config.py && \
    echo "DEFAULT_API_HOST = '${DEFAULT_API_HOST}'" >> build_config.py && \
    echo "DEFAULT_API_KEY = '${DEFAULT_API_KEY}'" >> build_config.py

FROM batonogov/pyinstaller-windows AS windows-builder
ARG DEFAULT_API_HOST="http://localhost:8080"
ARG DEFAULT_API_KEY=""
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY isbn_lookup_excel_desktop_ui.py ./
RUN echo "# This file is auto-generated during build" > build_config.py && \
    echo "DEFAULT_API_HOST = '${DEFAULT_API_HOST}'" >> build_config.py && \
    echo "DEFAULT_API_KEY = '${DEFAULT_API_KEY}'" >> build_config.py