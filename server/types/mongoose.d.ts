/**
 * populate() replaces a reference id with the referenced document.
 *
 * The schemas are plain JavaScript, so mongoose types a populated path as the
 * reference's ObjectId. At runtime `post.userId` is a user document with
 * `username`, `status` and the rest. Without this, every populate read reports a
 * property that does not exist, which is noise rather than a defect: the field
 * list comes from the select() beside each query.
 */
import 'mongoose';

declare module 'mongoose' {
  namespace Types {
    interface ObjectId {
      [key: string]: any;
    }
  }
}
