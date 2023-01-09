import ResolvablePromise from './ResolvablePromise';

/**
 * Object that is stored in the queue
 */
interface PromiseWrapper<TResult> {
  worker: () => Promise<TResult>;
  resolve: (value: TResult | PromiseLike<TResult>) => void;
  reject: (reason?: string) => void;
}

/**
 * Options for the PromiseQueue constructor
 */
interface PromiseQueueOptions {
  /**
   * The limit for number of concurrent promises to run
   * @default 1
   */
  concurrentLimit?: number;
}

/**
 * A queue that manages promises that will be execute them in order.
 * If the `concurrentLimit` option is passed in the queue will run up
 * to that limit of promises at the same time (becoming similar to a concurrency pool)
 */
export default class PromiseQueue<TResult = unknown> {
  private readonly queue: Array<PromiseWrapper<TResult>> = [];

  private readonly inProgressPromises = [];

  private readonly concurrentLimit: number = 1;

  constructor(options?: PromiseQueueOptions) {
    this.concurrentLimit = options?.concurrentLimit ?? 1;
  }

  private onQueueCompletePromise: ResolvablePromise<true> | undefined;

  private removeFromInProgress(promise: Promise<unknown>) {
    const index = this.inProgressPromises.findIndex((v) => v === promise);
    if (index < 0) return; // If it's not in progress there's not much we can do
    this.inProgressPromises.splice(index, 1);
  }

  private addToInProgress(promise: Promise<unknown>) {
    this.inProgressPromises.push(promise);
  }

  private addToQueue(promiseWrapper: PromiseWrapper<TResult>) {
    this.queue.push(promiseWrapper);
    if (this.onQueueCompletePromise === undefined) {
      this.onQueueCompletePromise = new ResolvablePromise();
    }
  }

  get onQueueComplete() {
    return this.onQueueCompletePromise?.toPromise();
  }

  /**
   * Enqueue a worker that will execute once it reaches position 0
   * @param worker The work that will be executed
   * @returns Promise that wraps the worker.  This can be used to track the worker promise
   */
  public enqueue(worker: () => Promise<TResult>): Promise<TResult> {
    return new Promise<TResult>((resolve, reject) => {
      this.addToQueue({
        worker,
        resolve,
        reject
      });
      this.dequeue();
    });
  }

  /**
   * Dequeue worker items until the queue is empty
   * @returns boolean If false no items are dequeued.  If true then work has been done and the queue is empty.
   */
  public dequeue() {
    if (this.inProgressPromises.length >= this.concurrentLimit) {
      return false;
    }
    const item = this.queue.shift();
    if (!item) {
      if (this.onQueueCompletePromise !== undefined) {
        this.onQueueCompletePromise.resolve(true);
        this.onQueueCompletePromise = undefined;
      }
      return false;
    }
    let promise: Promise<TResult>;
    try {
      promise = item.worker();
      this.addToInProgress(promise);
      promise
        .then((value) => {
          this.removeFromInProgress(promise);
          item.resolve(value);
          this.dequeue();
        })
        .catch((err) => {
          this.removeFromInProgress(promise);
          item.reject(err);
          this.dequeue();
        });
    } catch (err) {
      this.removeFromInProgress(promise);
      item.reject(err);
    }
    this.dequeue(); // try to dequeue again in case concurrentLimit hasn't been hit yet
    return true;
  }
}
