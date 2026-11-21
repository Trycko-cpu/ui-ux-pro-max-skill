"""Débruitage d'une image float (H, W, 3) avec Intel Open Image Denoise, la bibliothèque livrée avec bpy.
   Usage autonome : python oidn.py entree.npy sortie.npy"""
import os, sys
import numpy as np


def denoise(rgb):
    import ctypes, glob
    import importlib.util
    root = os.path.dirname(importlib.util.find_spec('bpy').origin)  # site-packages/bpy (le module, pas les scripts)
    cand = [p for p in glob.glob(os.path.join(root, '**', 'libOpenImageDenoise.so*'), recursive=True) if 'device' not in p and 'core' not in p]
    lib = ctypes.CDLL(cand[0])
    lib.oidnNewDevice.restype = ctypes.c_void_p
    lib.oidnNewFilter.restype = ctypes.c_void_p
    lib.oidnNewFilter.argtypes = [ctypes.c_void_p, ctypes.c_char_p]
    lib.oidnCommitDevice.argtypes = [ctypes.c_void_p]
    lib.oidnSetSharedFilterImage.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_void_p, ctypes.c_int,
                                             ctypes.c_size_t, ctypes.c_size_t, ctypes.c_size_t, ctypes.c_size_t, ctypes.c_size_t]
    lib.oidnSetFilterBool.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_bool]
    lib.oidnCommitFilter.argtypes = [ctypes.c_void_p]
    lib.oidnExecuteFilter.argtypes = [ctypes.c_void_p]
    lib.oidnGetDeviceError.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_char_p)]
    h, w, _ = rgb.shape
    src = np.ascontiguousarray(rgb, dtype=np.float32)
    dst = np.zeros_like(src)
    dev = lib.oidnNewDevice(1)  # CPU
    lib.oidnCommitDevice(dev)
    f = lib.oidnNewFilter(dev, b'RT')
    lib.oidnSetSharedFilterImage(f, b'color', src.ctypes.data, 3, w, h, 0, 0, 0)
    lib.oidnSetSharedFilterImage(f, b'output', dst.ctypes.data, 3, w, h, 0, 0, 0)
    lib.oidnSetFilterBool(f, b'hdr', True)
    lib.oidnCommitFilter(f)
    lib.oidnExecuteFilter(f)
    msg = ctypes.c_char_p()
    if lib.oidnGetDeviceError(dev, ctypes.byref(msg)):
        print('OIDN :', msg.value)
        return rgb
    return dst


if __name__ == '__main__':
    px = np.load(sys.argv[1])
    px[..., :3] = denoise(px[..., :3])
    np.save(sys.argv[2], px)
