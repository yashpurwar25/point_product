import numpy as np

arr = np.load("001000_segmented.npy")
print("shape:", arr.shape)
print("dtype:", arr.dtype)
print(arr[:5])
