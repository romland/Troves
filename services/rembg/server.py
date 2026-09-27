import asyncio
import os
import multiprocessing
from concurrent.futures import ThreadPoolExecutor
from typing import Optional
from fastapi import FastAPI, File, Form, Query, Response
from fastapi.middleware.cors import CORSMiddleware
from rembg import remove, new_session
import onnxruntime as ort
import uvicorn

app = FastAPI(title="Rembg GPU Server")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serializes ONNX Runtime inference onto a single persistent thread to prevent
# cross-thread CUDA session execution deadlocks on WSL2/Docker GPU passthrough.
executor = ThreadPoolExecutor(max_workers=1)
sessions = {}

def _process(
    data: bytes,
    model_name: str,
    alpha_matting: bool,
    af: int,
    ab: int,
    ae: int,
    only_mask: bool,
    post_process_mask: bool,
    decontaminate: bool,
    vitmatte: bool,
) -> bytes:
    if model_name not in sessions:
        opts = ort.SessionOptions()
        cpu_count = int(os.environ.get("OMP_NUM_THREADS", multiprocessing.cpu_count()))
        opts.intra_op_num_threads = cpu_count
        opts.inter_op_num_threads = 1
        opts.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
        sessions[model_name] = new_session(model_name, sess_options=opts)
    return remove(
        data,
        session=sessions[model_name],
        alpha_matting=alpha_matting,
        alpha_matting_foreground_threshold=af,
        alpha_matting_background_threshold=ab,
        alpha_matting_erode_size=ae,
        only_mask=only_mask,
        post_process_mask=post_process_mask,
        decontaminate=decontaminate,
        vitmatte=vitmatte,
    )

@app.post("/api/remove")
async def remove_endpoint(
    file: bytes = File(...),
    model: str = Query(default="u2net"),
    a: bool = Query(default=False),
    af: int = Query(default=240),
    ab: int = Query(default=10),
    ae: int = Query(default=10),
    om: bool = Query(default=False),
    ppm: bool = Query(default=False),
    dc: bool = Query(default=False),
    vm: bool = Query(default=False),
):
    loop = asyncio.get_running_loop()
    result = await loop.run_in_executor(
        executor,
        _process,
        file,
        model,
        a,
        af,
        ab,
        ae,
        om,
        ppm,
        dc,
        vm,
    )
    return Response(content=result, media_type="image/png")

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=7000)