FROM ghcr.nju.edu.cn/xinnan-tech/xiaozhi-esp32-server@sha256:3aab4836f012f59145926ac023a45857f6a87e9b6089eea7ffa277faafcfe887

COPY core/handle/family_page_router.py /opt/xiaozhi-esp32-server/core/handle/family_page_router.py
COPY build/apply_page_router.py /tmp/apply_page_router.py
RUN python /tmp/apply_page_router.py && rm /tmp/apply_page_router.py
