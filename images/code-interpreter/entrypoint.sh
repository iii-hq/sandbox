#!/bin/bash
set -e

if [ "$1" = "jupyter" ]; then
    exec jupyter kernelgateway \
        --KernelGatewayApp.ip=0.0.0.0 \
        --KernelGatewayApp.port=8888 \
        --KernelGatewayApp.api=kernel_gateway.notebook_http \
        --KernelGatewayApp.allow_origin='*'
fi

exec tail -f /dev/null
