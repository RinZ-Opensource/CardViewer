using System;
using System.IO;

namespace CardMakerMobile.Runtime
{
    internal sealed class LimitedReadStream : Stream
    {
        private readonly Stream inner;
        private long remaining;

        public LimitedReadStream(Stream inner, long length)
        {
            this.inner = inner;
            remaining = length;
        }

        public override bool CanRead
        {
            get { return true; }
        }

        public override bool CanSeek
        {
            get { return false; }
        }

        public override bool CanWrite
        {
            get { return false; }
        }

        public override long Length
        {
            get { throw new NotSupportedException(); }
        }

        public override long Position
        {
            get { throw new NotSupportedException(); }
            set { throw new NotSupportedException(); }
        }

        public override int Read(byte[] buffer, int offset, int count)
        {
            if (remaining <= 0)
            {
                return 0;
            }

            var allowed = (int)Math.Min(count, remaining);
            var read = inner.Read(buffer, offset, allowed);
            if (read == 0)
            {
                throw new InvalidDataException("Truncated cmpack tar entry data.");
            }
            remaining -= read;
            return read;
        }

        public void Drain()
        {
            var buffer = new byte[81920];
            while (remaining > 0)
            {
                Read(buffer, 0, (int)Math.Min(buffer.Length, remaining));
            }
        }

        public override void Flush()
        {
            throw new NotSupportedException();
        }

        public override long Seek(long offset, SeekOrigin origin)
        {
            throw new NotSupportedException();
        }

        public override void SetLength(long value)
        {
            throw new NotSupportedException();
        }

        public override void Write(byte[] buffer, int offset, int count)
        {
            throw new NotSupportedException();
        }
    }
}
