.PHONY: xm-vendor xm-vendor-build xm-vendor-pack

XM_VENDOR_BUILD_PACKAGES = \
	@jitl/quickjs-ffi-types \
	@jitl/quickjs-wasmfile-debug-asyncify \
	@jitl/quickjs-wasmfile-debug-sync \
	@jitl/quickjs-wasmfile-release-asyncify \
	@jitl/quickjs-wasmfile-release-sync \
	@jitl/quickjs-singlefile-cjs-release-asyncify \
	@jitl/quickjs-singlefile-cjs-release-sync \
	quickjs-emscripten-core \
	quickjs-emscripten

XM_VENDOR_PACK_PACKAGES = \
	@jitl/quickjs-ffi-types \
	@jitl/quickjs-wasmfile-debug-asyncify \
	@jitl/quickjs-wasmfile-debug-sync \
	@jitl/quickjs-wasmfile-release-asyncify \
	@jitl/quickjs-wasmfile-release-sync \
	quickjs-emscripten-core \
	quickjs-emscripten

xm-vendor: xm-vendor-pack

xm-vendor-build:
	pnpm run build:codegen
	for package in $(XM_VENDOR_BUILD_PACKAGES); do \
		pnpm --filter "$$package" build || exit $$?; \
	done

xm-vendor-pack: xm-vendor-build
	rm -rf build/xm-vendor
	mkdir -p build/xm-vendor
	for package in $(XM_VENDOR_PACK_PACKAGES); do \
		pnpm --filter "$$package" pack --pack-destination "$(CURDIR)/build/xm-vendor" || exit $$?; \
	done
