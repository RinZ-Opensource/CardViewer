using System.Collections.Generic;

namespace CardMakerMobile.Runtime
{
    public sealed class MobileCardEdits
    {
        public MobileCardEdits()
        {
            PrintFields = new Dictionary<string, string>();
        }

        public string Game { get; set; }
        public string Id { get; set; }
        public string DataName { get; set; }
        public Dictionary<string, string> PrintFields { get; private set; }

        public string Key
        {
            get { return MobileEditSession.CardKey(Game, Id); }
        }

        public MobileCardRecord ApplyTo(MobileCardRecord card)
        {
            var edited = card.Clone();
            foreach (var item in PrintFields)
            {
                edited.SetPrintField(item.Key, item.Value);
            }
            return edited;
        }
    }
}
