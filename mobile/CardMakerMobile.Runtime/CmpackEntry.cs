namespace CardMakerMobile.Runtime
{
    public sealed class CmpackEntry
    {
        public CmpackEntry(string archivePath, long size, char typeFlag)
        {
            ArchivePath = archivePath;
            Size = size;
            TypeFlag = typeFlag;
        }

        public string ArchivePath { get; private set; }
        public long Size { get; private set; }
        public char TypeFlag { get; private set; }

        public bool IsRegularFile
        {
            get { return TypeFlag == '\0' || TypeFlag == '0'; }
        }
    }
}
