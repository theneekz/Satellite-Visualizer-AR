import time
import logging
from functools import wraps
from contextlib import contextmanager

# Configure your application logger
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(filename)s:%(funcName)s:%(lineno)s %(message)s",
    handlers=[logging.StreamHandler()],
)
logger = logging.getLogger("backend_logger")


# Decorator for timing entire functions. Ex:
# @time_function
# def fetch_xyz():
def time_function(func):
    @wraps(func)
    def wrapper(*args, **kwargs):
        # The wrapper's caller can be framework code (e.g. FastAPI's threadpool),
        # so attribute the log to the decorated function's definition instead.
        code = func.__code__
        start_time = time.perf_counter()
        logger.handle(logger.makeRecord(
            logger.name, logging.INFO, code.co_filename, code.co_firstlineno,
            f"Function '{func.__name__}' started", args=(), exc_info=None, func=func.__name__))
        result = func(*args, **kwargs)
        end_time = time.perf_counter()
        execution_time = end_time - start_time
        logger.handle(logger.makeRecord(
            logger.name, logging.INFO, code.co_filename, code.co_firstlineno,
            f"Function '{func.__name__}' executed in {execution_time:.4f} seconds", args=(), exc_info=None, func=func.__name__))
        return result
    return wrapper


# Context manager for timing specific code blocks. Ex:
# with time_block("fetch from xyz API"):
#   fetch_xyz()
@contextmanager
def time_block(task_name):
    start_time = time.perf_counter()
    try:
        yield
    finally:
        end_time = time.perf_counter()
        execution_time = end_time - start_time
        logger.info(
            f"Task '{task_name}' executed in {execution_time:.4f} seconds", stacklevel=3)


def log(*args):
    logger.info(" ".join(map(str, args)), stacklevel=2)


def log_error(*args):
    logger.error(f'Error: {" ".join(map(str, args))}', stacklevel=2)
